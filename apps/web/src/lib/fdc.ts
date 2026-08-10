/**
 * The Flare Data Connector lifecycle, run entirely in the browser.
 *
 *   verifier prepareRequest  →  FdcHub.requestAttestation (pays the fee)
 *   →  wait for the voting round to finalize (Relay)
 *   →  fetch the Merkle proof from the DA layer
 *   →  submit it to InvoiceRegistry
 *
 * Both Flare services send `Access-Control-Allow-Origin: *`, so no backend and no
 * proxy is needed — whoever is looking at the page can drive an invoice to its
 * outcome themselves, paying the (negligible) gas. That is what lets the whole
 * product deploy as a static site.
 *
 * Note the DA layer's CORS allowlist does not include `x-api-key`, so that
 * header must not be sent from a browser. It is not required.
 */
import { ethers } from "ethers";
import { CHAIN } from "./config";
import { readProvider, registryWrite } from "./registry";
import type { Invoice } from "./types";

const VERIFIER_BASE = "https://fdc-verifiers-testnet.flare.network";
/** The public testnet verifier accepts this well-known key. */
const VERIFIER_KEY = "00000000-0000-0000-0000-000000000000";
const DA_BASE = "https://ctn2-data-availability.flare.network";

const FDC_PROTOCOL_ID = 200;
const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

const REGISTRY_ABI = ["function getContractAddressByName(string) view returns (address)"];
const FDC_HUB_ABI = [
  "function requestAttestation(bytes data) payable",
  "function fdcRequestFeeConfigurations() view returns (address)",
];
const FEE_CONFIG_ABI = ["function getRequestFee(bytes data) view returns (uint256)"];
const RELAY_ABI = [
  "function isFinalized(uint256 protocolId, uint256 votingRoundId) view returns (bool)",
  "function getVotingRoundId(uint256 timestamp) view returns (uint256)",
];

const XRP_PAYMENT_RESPONSE =
  "tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp," +
  " tuple(bytes32 transactionId, address proofOwner) requestBody," +
  " tuple(uint64 blockNumber, uint64 blockTimestamp, string sourceAddress, bytes32 sourceAddressHash," +
  " bytes32 receivingAddressHash, bytes32 intendedReceivingAddressHash, int256 spentAmount," +
  " int256 intendedSpentAmount, int256 receivedAmount, int256 intendedReceivedAmount," +
  " bool hasMemoData, bytes firstMemoData, bool hasDestinationTag, uint256 destinationTag, uint8 status) responseBody)";

const XRP_NONEXISTENCE_RESPONSE =
  "tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp," +
  " tuple(uint64 minimalBlockNumber, uint64 deadlineBlockNumber, uint64 deadlineTimestamp," +
  " bytes32 destinationAddressHash, uint256 amount, bool checkFirstMemoData, bytes32 firstMemoDataHash," +
  " bool checkDestinationTag, uint256 destinationTag, address proofOwner) requestBody," +
  " tuple(uint64 minimalBlockTimestamp, uint64 firstOverflowBlockNumber, uint64 firstOverflowBlockTimestamp) responseBody)";

const toBytes32 = (s: string): string =>
  "0x" +
  Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0");

const SOURCE_TESTXRP = toBytes32("testXRP");

/** Progress callback so the UI can narrate the ~2 minute wait. */
export type FdcProgress = (stage: FdcStage, detail?: string) => void;
export type FdcStage =
  | "preparing"
  | "submitting"
  | "waiting_round"
  | "fetching_proof"
  | "submitting_outcome"
  | "done";

async function protocolContract(name: string, abi: string[], runner: ethers.ContractRunner) {
  const reg = new ethers.Contract(FLARE_CONTRACT_REGISTRY, REGISTRY_ABI, runner);
  const addr = await reg.getContractAddressByName(name);
  if (addr === ethers.ZeroAddress) throw new Error(`${name} not found in FlareContractRegistry`);
  return new ethers.Contract(addr, abi, runner);
}

/**
 * Ask the verifier to encode and integrity-check an attestation request.
 *
 * A payment seen on the XRPL seconds ago is not attestable yet: the verifier waits for
 * finality (3 confirmations, ~12 s) and answers `TRANSACTION DOES NOT EXIST` until then.
 * The UI notices payments almost immediately, so a user who clicks straight away lands
 * in exactly that window — it is a race to wait out, not a rejection to surface.
 */
async function prepareRequest(
  attestationName: string,
  requestBody: unknown,
  onProgress?: FdcProgress
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${VERIFIER_BASE}/verifier/xrp/${attestationName}/prepareRequest`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": VERIFIER_KEY },
      body: JSON.stringify({
        attestationType: toBytes32(attestationName),
        sourceId: SOURCE_TESTXRP,
        requestBody,
      }),
    });
    const body = await res.json().catch(() => ({}));

    if (res.ok && body.status === "VALID") return body.abiEncodedRequest;

    const notYetFinal =
      typeof body.status === "string" && body.status.includes("DOES NOT EXIST");
    if (!notYetFinal || attempt >= 10) {
      throw new Error(`Verifier rejected the ${attestationName} request: ${JSON.stringify(body)}`);
    }

    onProgress?.("preparing", "waiting for XRPL finality");
    await new Promise((r) => setTimeout(r, 6_000));
  }
}

async function submitRequest(signer: ethers.Signer, encoded: string): Promise<number> {
  const hub = await protocolContract("FdcHub", FDC_HUB_ABI, signer);
  const feeConfig = new ethers.Contract(
    await hub.fdcRequestFeeConfigurations(),
    FEE_CONFIG_ABI,
    signer
  );
  const fee = await feeConfig.getRequestFee(encoded);

  const tx = await hub.requestAttestation(encoded, { value: fee });
  const receipt = await tx.wait();
  const block = await readProvider.getBlock(receipt.blockNumber);

  const relay = await protocolContract("Relay", RELAY_ABI, readProvider);
  return Number(await relay.getVotingRoundId(block!.timestamp));
}

async function waitForRound(roundId: number, onProgress?: FdcProgress): Promise<void> {
  const relay = await protocolContract("Relay", RELAY_ABI, readProvider);
  for (let i = 0; i < 60; i++) {
    if (await relay.isFinalized(FDC_PROTOCOL_ID, roundId)) return;
    onProgress?.("waiting_round", `round ${roundId}, ${i * 10}s elapsed`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`Voting round ${roundId} did not finalize in time`);
}

async function fetchProof(roundId: number, encoded: string, responseAbi: string) {
  const res = await fetch(`${DA_BASE}/api/v1/fdc/proof-by-request-round-raw`, {
    method: "POST",
    // No X-API-KEY: the DA layer's CORS allowlist rejects that header, and it is not needed.
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ votingRoundId: roundId, requestBytes: encoded }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.response_hex) throw new Error(`DA layer: ${JSON.stringify(body)}`);

  const [data] = ethers.AbiCoder.defaultAbiCoder().decode([responseAbi], body.response_hex);
  // ethers Results are frozen; contract calls need mutable plain arrays.
  const plain = (v: any): any => (v instanceof ethers.Result ? v.toArray().map(plain) : v);
  return { merkleProof: body.proof, data: plain(data) };
}

async function obtainProof(
  signer: ethers.Signer,
  encoded: string,
  responseAbi: string,
  onProgress?: FdcProgress
) {
  onProgress?.("submitting");
  const roundId = await submitRequest(signer, encoded);

  onProgress?.("waiting_round", `round ${roundId}`);
  await waitForRound(roundId, onProgress);

  onProgress?.("fetching_proof");
  // The DA layer can lag finalization by a few seconds.
  for (let i = 0; ; i++) {
    try {
      return await fetchProof(roundId, encoded, responseAbi);
    } catch (err) {
      if (i >= 12) throw err;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

/**
 * The consent path: prove a payment from the debtor carrying this invoice's tag,
 * which admits the debt. One drop is enough — it is the debtor's signature over
 * the terms, not payment. Without it a later mark reaches no payment record.
 */
export async function acknowledge(
  signer: ethers.Signer,
  invoiceId: bigint,
  xrplTxHash: string,
  onProgress?: FdcProgress
): Promise<string> {
  onProgress?.("preparing");
  const encoded = await prepareRequest(
    "XRPPayment",
    {
      transactionId: "0x" + xrplTxHash.replace(/^0x/i, "").toUpperCase(),
      proofOwner: ethers.ZeroAddress,
    },
    onProgress
  );

  const proof = await obtainProof(signer, encoded, XRP_PAYMENT_RESPONSE, onProgress);

  onProgress?.("submitting_outcome");
  const receipt = await (await registryWrite(signer).acknowledge(invoiceId, proof)).wait();
  onProgress?.("done");
  return receipt.hash;
}

/**
 * The quittance path: prove the XRPL payment and settle the invoice.
 * Takes about two minutes, almost all of it one FDC voting round.
 */
export async function settleWithPayment(
  signer: ethers.Signer,
  invoiceId: bigint,
  xrplTxHash: string,
  onProgress?: FdcProgress
): Promise<string> {
  onProgress?.("preparing");
  const encoded = await prepareRequest(
    "XRPPayment",
    {
      transactionId: "0x" + xrplTxHash.replace(/^0x/i, "").toUpperCase(),
      proofOwner: ethers.ZeroAddress,
    },
    onProgress
  );

  const proof = await obtainProof(signer, encoded, XRP_PAYMENT_RESPONSE, onProgress);

  onProgress?.("submitting_outcome");
  const receipt = await (await registryWrite(signer).settle(invoiceId, proof)).wait();
  onProgress?.("done");
  return receipt.hash;
}

/**
 * The mark path: prove no payment exists over the invoice's exact window.
 *
 * Every parameter below is read from the invoice itself. The registry enforces
 * the same equality on-chain — a nonexistence proof over any other window would
 * be a proof about a different question.
 */
export async function markDelinquent(
  signer: ethers.Signer,
  invoice: Invoice,
  onProgress?: FdcProgress
): Promise<string> {
  onProgress?.("preparing");
  const encoded = await prepareRequest(
    "XRPPaymentNonexistence",
    {
      minimalBlockNumber: invoice.minimalBlockNumber.toString(),
      deadlineBlockNumber: invoice.deadlineBlockNumber.toString(),
      deadlineTimestamp: invoice.deadlineTimestamp.toString(),
      destinationAddressHash: invoice.payeeAddressHash,
      amount: invoice.amountDrops.toString(),
      checkFirstMemoData: false,
      firstMemoDataHash: ethers.ZeroHash,
      checkDestinationTag: true,
      destinationTag: invoice.destinationTag.toString(),
      proofOwner: ethers.ZeroAddress,
    },
    onProgress
  );

  const proof = await obtainProof(signer, encoded, XRP_NONEXISTENCE_RESPONSE, onProgress);

  onProgress?.("submitting_outcome");
  const receipt = await (await registryWrite(signer).markDelinquent(invoice.id, proof)).wait();
  onProgress?.("done");
  return receipt.hash;
}

export const STAGE_TEXT: Record<FdcStage, string> = {
  preparing: "Preparing the attestation request…",
  submitting: "Submitting to the Data Connector…",
  waiting_round: "Waiting for the voting round to finalize…",
  fetching_proof: "Fetching the Merkle proof…",
  submitting_outcome: "Recording the outcome on Flare…",
  done: "Done",
};

export const FAUCET_HINT = `Needs a little C2FLR for gas: ${CHAIN.faucet}`;
