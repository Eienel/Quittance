/**
 * The FDC request/proof lifecycle, end to end:
 *
 *   verifier prepareRequest  →  FdcHub.requestAttestation (with fee)
 *   →  wait for the voting round to finalize (Relay)
 *   →  fetch the Merkle proof from the DA layer
 *   →  hand { merkleProof, data } to the consuming contract.
 *
 * Everything protocol-side is resolved through FlareContractRegistry at runtime.
 */
const { ethers } = require("ethers");
const cfg = require("./config");

const FDC_PROTOCOL_ID = 200;

const toBytes32 = (s) =>
  "0x" + Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");

const ATT_XRP_PAYMENT = toBytes32("XRPPayment");
const ATT_XRP_NONEXISTENCE = toBytes32("XRPPaymentNonexistence");
const SOURCE_TESTXRP = toBytes32("testXRP");

const REGISTRY_ABI = [
  "function getContractAddressByName(string) view returns (address)",
];
const FDC_HUB_ABI = [
  "function requestAttestation(bytes data) payable",
  "function fdcRequestFeeConfigurations() view returns (address)",
];
const FEE_CONFIG_ABI = [
  "function getRequestFee(bytes data) view returns (uint256)",
];
const RELAY_ABI = [
  "function isFinalized(uint256 protocolId, uint256 votingRoundId) view returns (bool)",
  "function getVotingRoundId(uint256 timestamp) view returns (uint256)",
];

// ABI shapes of the two attestation responses, as the verification contracts expect them.
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

function provider() {
  return new ethers.JsonRpcProvider(cfg.rpc);
}

function signer(p = provider()) {
  if (!cfg.privateKey) throw new Error("PRIVATE_KEY not set");
  return new ethers.Wallet(cfg.privateKey, p);
}

async function protocolContract(name, abi, runner) {
  const registry = new ethers.Contract(
    cfg.flareContractRegistry,
    REGISTRY_ABI,
    runner
  );
  const addr = await registry.getContractAddressByName(name);
  if (addr === ethers.ZeroAddress)
    throw new Error(`${name} not found in FlareContractRegistry`);
  return new ethers.Contract(addr, abi, runner);
}

/** Ask the verifier to encode + integrity-check an attestation request. */
async function prepareRequest(attestationName, sourcePath, requestBody) {
  const url = `${cfg.verifierBase}/verifier/xrp/${attestationName}/prepareRequest`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-KEY": cfg.verifierApiKey,
    },
    body: JSON.stringify({
      attestationType: toBytes32(attestationName),
      sourceId: SOURCE_TESTXRP,
      requestBody,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status !== "VALID") {
    throw new Error(
      `verifier rejected ${attestationName}: ${res.status} ${JSON.stringify(body)}`
    );
  }
  return body.abiEncodedRequest;
}

function prepareXrpPaymentRequest(transactionId) {
  return prepareRequest("XRPPayment", "xrp", {
    transactionId,
    proofOwner: ethers.ZeroAddress,
  });
}

/**
 * The request body here must mirror the invoice terms exactly — the registry
 * enforces that on-chain, so any drift just produces an unusable proof.
 */
function prepareNonexistenceRequest(invoice) {
  return prepareRequest("XRPPaymentNonexistence", "xrp", {
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
  });
}

/** Pay the configured fee and submit the encoded request. Returns the voting round id. */
async function submitRequest(abiEncodedRequest, log = console.error) {
  const s = signer();
  const hub = await protocolContract("FdcHub", FDC_HUB_ABI, s);
  const feeConfig = new ethers.Contract(
    await hub.fdcRequestFeeConfigurations(),
    FEE_CONFIG_ABI,
    s
  );
  const fee = await feeConfig.getRequestFee(abiEncodedRequest);

  const tx = await hub.requestAttestation(abiEncodedRequest, { value: fee });
  const receipt = await tx.wait();
  const block = await s.provider.getBlock(receipt.blockNumber);

  const relay = await protocolContract("Relay", RELAY_ABI, s.provider);
  const roundId = await relay.getVotingRoundId(block.timestamp);
  log(
    `submitted to FdcHub in tx ${receipt.hash}, fee ${ethers.formatEther(fee)}, voting round ${roundId}`
  );
  return Number(roundId);
}

/** Poll the Relay until the round's FDC Merkle root is finalized (~90–180 s). */
async function waitForRound(roundId, log = console.error) {
  const relay = await protocolContract("Relay", RELAY_ABI, provider());
  for (let i = 0; i < 60; i++) {
    if (await relay.isFinalized(FDC_PROTOCOL_ID, roundId)) {
      log(`round ${roundId} finalized`);
      return;
    }
    log(`round ${roundId} not finalized yet, waiting...`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`round ${roundId} did not finalize in time`);
}

/** Fetch the Merkle proof + full response from the DA layer and decode it. */
async function fetchProof(roundId, abiEncodedRequest, responseAbi) {
  const res = await fetch(
    `${cfg.daBase}/api/v1/fdc/proof-by-request-round-raw`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-API-KEY": cfg.daApiKey,
      },
      body: JSON.stringify({
        votingRoundId: roundId,
        requestBytes: abiEncodedRequest,
      }),
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.response_hex) {
    throw new Error(`DA layer: ${res.status} ${JSON.stringify(body)}`);
  }
  const [data] = ethers.AbiCoder.defaultAbiCoder().decode(
    [responseAbi],
    body.response_hex
  );
  // ethers Results are frozen; contract calls need mutable plain arrays.
  const plain = (v) => (v instanceof ethers.Result ? v.toArray().map(plain) : v);
  return { merkleProof: body.proof, data: plain(data) };
}

/** Full pipeline: prepare → submit → wait → proof. */
async function obtainProof(abiEncodedRequest, responseAbi, log = console.error) {
  const roundId = await submitRequest(abiEncodedRequest, log);
  await waitForRound(roundId, log);
  // The DA layer can lag finalization by a few seconds.
  for (let i = 0; ; i++) {
    try {
      return await fetchProof(roundId, abiEncodedRequest, responseAbi);
    } catch (err) {
      if (i >= 12) throw err;
      log(`proof not in DA layer yet (${err.message}), retrying...`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

module.exports = {
  ATT_XRP_PAYMENT,
  ATT_XRP_NONEXISTENCE,
  SOURCE_TESTXRP,
  XRP_PAYMENT_RESPONSE,
  XRP_NONEXISTENCE_RESPONSE,
  toBytes32,
  provider,
  signer,
  prepareXrpPaymentRequest,
  prepareNonexistenceRequest,
  submitRequest,
  waitForRound,
  fetchProof,
  obtainProof,
};
