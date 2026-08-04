import { useEffect, useState } from "react";
import { findPaymentForInvoice, type SeenPayment } from "@/lib/xrpl";
import { displayStatus, secondsToDeadline } from "@/lib/format";
import type { Invoice, Pipeline } from "@/lib/types";

/** Live seconds counter, ticking once a second. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Where an invoice is between issuance and its outcome.
 *
 * The point of this hook is the middle: from the payer hitting send to the
 * receipt appearing is about two minutes, almost all of it one FDC voting round.
 * The XRPL side is visible to us immediately, so we can show real progress
 * across that gap instead of a spinner.
 *
 *   awaiting_payment → payment_seen → proving → settled
 *   awaiting_payment → deadline_passed → proving → delinquent
 *
 * `payeeAddress` is needed to query the XRPL and is not recoverable from the
 * invoice (which stores only a hash) — pass it from the address book or from
 * whatever the user typed. Without it we still report the on-chain stages.
 */
export function usePipeline(inv: Invoice | null, payeeAddress: string | null): Pipeline {
  const now = useNow();
  const [seen, setSeen] = useState<SeenPayment | null>(null);

  useEffect(() => {
    if (!inv || !payeeAddress) return;
    const status = displayStatus(inv, now);
    if (status === "settled" || status === "delinquent") return;

    let cancelled = false;
    const check = async () => {
      try {
        const payment = await findPaymentForInvoice(payeeAddress, inv);
        if (!cancelled && payment) setSeen(payment);
      } catch {
        // The XRPL endpoint hiccuping should not break the page; the next tick retries.
      }
    };
    void check();
    const id = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv?.id.toString(), payeeAddress, inv?.status]);

  if (!inv) return { stage: "awaiting_payment", secondsToDeadline: 0 };

  const remaining = secondsToDeadline(inv, now);
  const status = displayStatus(inv, now);

  if (status === "settled") {
    return { stage: "settled", xrplTxHash: seen?.hash, secondsToDeadline: remaining };
  }
  if (status === "delinquent") {
    return { stage: "delinquent", secondsToDeadline: remaining };
  }
  // Open on-chain, but we already know how it ends — the proof is just in flight.
  if (seen) {
    return { stage: "proving", xrplTxHash: seen.hash, secondsToDeadline: remaining };
  }
  if (status === "lapsed") {
    return { stage: "proving", secondsToDeadline: remaining };
  }
  return { stage: "awaiting_payment", secondsToDeadline: remaining };
}

/** Human label + whether this stage is a terminal one. */
export const STAGE_LABELS: Record<Pipeline["stage"], { label: string; terminal: boolean }> = {
  awaiting_payment: { label: "Awaiting payment", terminal: false },
  payment_seen: { label: "Payment seen on XRPL", terminal: false },
  deadline_passed: { label: "Deadline passed", terminal: false },
  proving: { label: "Proving on Flare…", terminal: false },
  settled: { label: "Settled", terminal: true },
  delinquent: { label: "Marked delinquent", terminal: true },
};
