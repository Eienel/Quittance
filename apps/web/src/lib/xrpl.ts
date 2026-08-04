/**
 * The XRPL half, over plain JSON-RPC.
 *
 * The UI can do all of this itself — no backend needed — which is what makes the
 * "payment seen" pipeline stage real rather than simulated.
 */
import { XRPL } from "./config";
import type { Invoice } from "./types";

async function rpc<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(XRPL.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params: [params] }),
  });
  if (!res.ok) throw new Error(`XRPL ${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.result?.error) throw new Error(`XRPL ${method}: ${body.result.error_message ?? body.result.error}`);
  return body.result as T;
}

export interface LedgerNow {
  ledgerIndex: number;
  /** Unix seconds, already converted from the Ripple epoch. */
  closeTimeUnix: number;
}

export async function ledgerNow(): Promise<LedgerNow> {
  const result = await rpc("ledger", { ledger_index: "validated" });
  return {
    ledgerIndex: Number(result.ledger_index ?? result.ledger.ledger_index),
    closeTimeUnix: Number(result.ledger.close_time) + XRPL.epochOffset,
  };
}

/**
 * Turn "N minutes from now" into the ledger index and timestamp an invoice needs.
 * Both are required: the FDC search window is bounded by index *and* close time.
 */
export async function deadlineFromMinutes(minutes: number): Promise<{
  minimalBlockNumber: number;
  deadlineBlockNumber: number;
  deadlineTimestamp: number;
}> {
  const { ledgerIndex, closeTimeUnix } = await ledgerNow();
  return {
    minimalBlockNumber: ledgerIndex,
    deadlineBlockNumber: ledgerIndex + Math.ceil((minutes * 60) / XRPL.secondsPerLedger),
    deadlineTimestamp: closeTimeUnix + minutes * 60,
  };
}

export interface SeenPayment {
  hash: string;
  ledgerIndex: number;
  amountDrops: bigint;
  from: string;
}

/**
 * Look for a payment matching this invoice's destination tag.
 *
 * This is how the UI shows "payment seen" within seconds, long before the FDC
 * round produces the proof that actually settles it on-chain.
 */
export async function findPaymentForInvoice(
  payeeAddress: string,
  inv: Invoice
): Promise<SeenPayment | null> {
  const result = await rpc("account_tx", {
    account: payeeAddress,
    ledger_index_min: Number(inv.minimalBlockNumber),
    ledger_index_max: -1,
    limit: 200,
  });

  for (const entry of result.transactions ?? []) {
    const tx = entry.tx_json ?? entry.tx;
    if (!tx || tx.TransactionType !== "Payment") continue;
    if (tx.Destination !== payeeAddress) continue;
    if (Number(tx.DestinationTag) !== inv.destinationTag) continue;

    // A Payment's delivered amount lives in metadata; the tx Amount is what was sent.
    const delivered = entry.meta?.delivered_amount ?? tx.Amount ?? entry.meta?.DeliveredAmount;
    const drops = typeof delivered === "string" ? BigInt(delivered) : 0n;
    if (drops < inv.amountDrops) continue; // underpayment does not settle

    return {
      hash: entry.hash ?? tx.hash,
      ledgerIndex: Number(entry.ledger_index ?? entry.tx_json?.ledger_index ?? 0),
      amountDrops: drops,
      from: tx.Account,
    };
  }
  return null;
}

/** Create and fund a testnet account. Handy for demos; never used for real funds. */
export async function fundTestAccount(): Promise<{ address: string; seed: string }> {
  const res = await fetch(XRPL.faucet, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`XRPL faucet: HTTP ${res.status}`);
  const body = await res.json();
  return {
    address: body.account.classicAddress ?? body.account.address,
    seed: body.seed,
  };
}
