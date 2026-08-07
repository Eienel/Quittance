import { ethers } from "ethers";
import InvoiceRegistryAbi from "../../abi/InvoiceRegistry.json";
import ScoreSenderAbi from "../../abi/ScoreInstructionSender.json";
import { CHAIN, CONTRACTS } from "./config";
import { InvoiceStatus, type Invoice, type PayerRecord } from "./types";

export const readProvider = new ethers.JsonRpcProvider(CHAIN.rpc);

export const registryRead = () =>
  new ethers.Contract(CONTRACTS.invoiceRegistry, InvoiceRegistryAbi, readProvider);

export const registryWrite = (signer: ethers.Signer) =>
  new ethers.Contract(CONTRACTS.invoiceRegistry, InvoiceRegistryAbi, signer);

export const scoreSenderWrite = (signer: ethers.Signer) =>
  new ethers.Contract(CONTRACTS.scoreInstructionSender, ScoreSenderAbi, signer);

/** ethers returns a frozen Result; normalize it into our own shape. */
function toInvoice(id: bigint, raw: ethers.Result | any): Invoice {
  return {
    id,
    issuer: raw.issuer,
    destinationTag: Number(raw.destinationTag),
    status: Number(raw.status) as InvoiceStatus,
    payeeAddressHash: raw.payeeAddressHash,
    amountDrops: raw.amountDrops,
    minimalBlockNumber: raw.minimalBlockNumber,
    deadlineBlockNumber: raw.deadlineBlockNumber,
    deadlineTimestamp: raw.deadlineTimestamp,
    payerAddressHash: raw.payerAddressHash,
    acknowledged: raw.acknowledged,
    bondAmount: raw.bondAmount,
    bondPoster: raw.bondPoster,
    settledByAddressHash: raw.settledByAddressHash,
    outcomeTimestamp: raw.outcomeTimestamp,
    metadataURI: raw.metadataURI,
  };
}

export async function getInvoiceCount(): Promise<number> {
  return Number(await registryRead().invoiceCount());
}

export async function getInvoice(id: bigint | number): Promise<Invoice> {
  const raw = await registryRead().getInvoice(id);
  return toInvoice(BigInt(id), raw);
}

export async function getInvoiceByTag(tag: number): Promise<Invoice> {
  const reg = registryRead();
  const raw = await reg.getInvoiceByTag(tag);
  const id: bigint = await reg.invoiceIdByTag(tag);
  return toInvoice(id, raw);
}

/**
 * Most recent invoices first.
 *
 * Invoice ids start at 1, and there is no "get all" call. For long lists prefer
 * `getInvoicesByEvents` — this per-id loop is one RPC round trip per invoice and
 * is only reasonable for a page's worth.
 */
export async function listInvoices(limit = 25, fromId?: number): Promise<Invoice[]> {
  const count = fromId ?? (await getInvoiceCount());
  const ids: bigint[] = [];
  for (let id = count; id > Math.max(0, count - limit); id--) ids.push(BigInt(id));
  return Promise.all(ids.map((id) => getInvoice(id)));
}

/**
 * Cheaper listing for long histories: one log query, then fetch only what you render.
 * `InvoiceCreated` is indexed on invoiceId, destinationTag and issuer.
 */
export async function getInvoiceIdsByIssuer(issuer: string, fromBlock = 0): Promise<bigint[]> {
  const reg = registryRead();
  const logs = await reg.queryFilter(reg.filters.InvoiceCreated(null, null, issuer), fromBlock);
  return logs.map((l) => (l as ethers.EventLog).args.invoiceId as bigint);
}

export async function getRecord(payerAddressHash: string): Promise<PayerRecord> {
  const raw = await registryRead().record(payerAddressHash);
  return {
    settledCount: raw.settledCount,
    delinquentCount: raw.delinquentCount,
    settledDrops: raw.settledDrops,
    delinquentDrops: raw.delinquentDrops,
    lastOutcomeTimestamp: raw.lastOutcomeTimestamp,
  };
}

export interface CreateInvoiceArgs {
  payeeAddressHash: string;
  /** Zero hash for a bearer invoice — anyone may settle, and a lapse marks nobody. */
  payerAddressHash: string;
  amountDrops: bigint;
  minimalBlockNumber: number;
  deadlineBlockNumber: number;
  deadlineTimestamp: number;
  metadataURI?: string;
}

/**
 * Issue an invoice. The assigned destination tag comes from the `InvoiceCreated`
 * event — a transaction's return value is not readable, only its logs.
 */
export async function createInvoice(
  signer: ethers.Signer,
  args: CreateInvoiceArgs
): Promise<{ invoiceId: bigint; destinationTag: number; txHash: string }> {
  const reg = registryWrite(signer);
  const tx = await reg.createInvoice(
    args.payeeAddressHash,
    args.payerAddressHash,
    args.amountDrops,
    args.minimalBlockNumber,
    args.deadlineBlockNumber,
    args.deadlineTimestamp,
    args.metadataURI ?? ""
  );
  const receipt = await tx.wait();
  const created = receipt.logs
    .map((l: ethers.Log) => {
      try {
        return reg.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((l: ethers.LogDescription | null) => l?.name === "InvoiceCreated");

  if (!created) throw new Error("InvoiceCreated event not found in receipt");
  return {
    invoiceId: created.args.invoiceId as bigint,
    destinationTag: Number(created.args.destinationTag),
    txHash: receipt.hash,
  };
}

/** Lock FLR against an invoice. Anyone may post; the poster gets it back on settlement. */
export async function postBond(
  signer: ethers.Signer,
  invoiceId: bigint,
  amountWei: bigint
): Promise<string> {
  const tx = await registryWrite(signer).postBond(invoiceId, { value: amountWei });
  return (await tx.wait()).hash;
}

/** Collect bond proceeds owed to you. Proceeds are pulled, never pushed. */
export async function withdraw(signer: ethers.Signer): Promise<string> {
  const tx = await registryWrite(signer).withdraw();
  return (await tx.wait()).hash;
}

export async function withdrawableOf(address: string): Promise<bigint> {
  return registryRead().withdrawable(address);
}

/**
 * Ask the TEE for a confidential score. The result arrives asynchronously from
 * the enclave, so this resolves when the request is on-chain, not when the score
 * is ready.
 *
 * NOTE: not usable until a TEE machine is registered for extension 65975.
 * Build against `fixtures.scores` until then.
 */
export async function requestScore(signer: ethers.Signer, payerAddressHash: string): Promise<string> {
  const tx = await scoreSenderWrite(signer).requestScore(payerAddressHash);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Turn a revert into something worth showing a user.
 *
 * These are real custom errors from InvoiceRegistry, and the field name in
 * ProofMismatch is usually the diagnosis — `destinationTag` almost always means
 * the payer sent XRP without the tag.
 */
export function decodeRegistryError(err: unknown): string | null {
  const data = (err as any)?.data ?? (err as any)?.error?.data ?? (err as any)?.info?.error?.data;
  if (typeof data !== "string") return null;

  try {
    const parsed = registryRead().interface.parseError(data);
    if (!parsed) return null;
    switch (parsed.name) {
      case "InvoiceNotOpen":
        return "This invoice already has an outcome — it cannot change.";
      case "ProofMismatch":
        return parsed.args[0] === "destinationTag"
          ? "The payment did not carry this invoice's destination tag, so it cannot be matched."
          : `The proof does not match the invoice's ${parsed.args[0]}.`;
      case "PaidAfterDeadline":
        return "Paid, but after the deadline — the invoice still lapses.";
      case "PaymentFailed":
        return Number(parsed.args[0]) === 1
          ? "The XRPL payment failed (sender's fault)."
          : "The XRPL payment failed (receiver's fault).";
      case "NoSuchInvoice":
        return "No such invoice.";
      case "InvalidProof":
        return "The Data Connector has not finalized this proof yet — try again shortly.";
      case "InvalidTerms":
        return `Invalid invoice terms: ${parsed.args[0]}.`;
      case "AlreadyAcknowledged":
        return "This debt has already been acknowledged.";
      case "NotAcknowledgeable":
        return "A bearer invoice names no debtor, so there is nothing to acknowledge.";
      case "WrongSourceChain":
        return "That proof is about a different XRPL network than this registry serves.";
      case "WrongAttestationType":
        return "That proof is the wrong kind of attestation for this action.";
      case "ZeroBond":
        return "A bond has to be more than zero.";
      case "BondPostedByAnother":
        return "Someone else already posted the bond on this invoice.";
      case "NoBond":
        return "There is no bond on this invoice.";
      case "NothingToWithdraw":
        return "Nothing to withdraw.";
      case "ReclaimTooEarly":
        return "The bond cannot be reclaimed until the grace period after the deadline has passed.";
      case "TransferFailed":
        return "The transfer failed — your address rejected the payment.";
      case "TagSpaceExhausted":
        return "This registry has issued every destination tag.";
      default:
        return parsed.name;
    }
  } catch {
    return null;
  }
}

/** Best-effort human message for any failure, contract error or not. */
export const errorMessage = (err: unknown): string =>
  decodeRegistryError(err) ??
  (err as any)?.shortMessage ??
  (err as any)?.message ??
  String(err);
