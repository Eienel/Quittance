import { useState } from "react";
import { markDelinquent, settleWithPayment, STAGE_TEXT, type FdcStage } from "@/lib/fdc";
import { errorMessage } from "@/lib/registry";
import { displayStatus } from "@/lib/format";
import { TIMING } from "@/lib/config";
import type { Invoice, Pipeline } from "@/lib/types";
import type { ethers } from "ethers";

/**
 * Drives an invoice to its outcome from the browser.
 *
 * Both Flare services involved allow cross-origin requests, so the whole
 * attestation lifecycle runs client-side. Nobody has to be running a server for
 * an invoice to settle — whoever is looking at the page can push it through,
 * paying a trivial amount of gas. That is what lets this deploy as a static site
 * and still work end to end.
 *
 * The wait is ~2 minutes, essentially all of it one FDC voting round, so the
 * stage text below is the whole UX. Don't replace it with a spinner.
 *
 * TODO(design): this is a prime candidate for real motion — a progress arc keyed
 * to TIMING.fdcRound, with the stage text beneath it.
 */
export default function OutcomeAction({
  invoice,
  pipeline,
  signer,
  onDone,
}: {
  invoice: Invoice;
  pipeline: Pipeline;
  signer: ethers.Signer | null;
  onDone?: () => void;
}) {
  const [stage, setStage] = useState<FdcStage | null>(null);
  const [detail, setDetail] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const status = displayStatus(invoice);
  if (status === "settled" || status === "delinquent") return null;

  const canSettle = !!pipeline.xrplTxHash;
  const canMark = status === "lapsed" && !pipeline.xrplTxHash;
  if (!canSettle && !canMark) return null;

  const running = stage !== null && stage !== "done";

  async function run() {
    if (!signer) return setError("Connect a wallet to record this outcome.");
    setError(null);
    setTxHash(null);
    const onProgress = (s: FdcStage, d?: string) => {
      setStage(s);
      setDetail(d ?? "");
    };
    try {
      const hash = canSettle
        ? await settleWithPayment(signer, invoice.id, pipeline.xrplTxHash!, onProgress)
        : await markDelinquent(signer, invoice, onProgress);
      setTxHash(hash);
      onDone?.();
    } catch (err) {
      setError(errorMessage(err));
      setStage(null);
    }
  }

  return (
    <div className="stub">
      <p>
        {canSettle
          ? "A matching payment is visible on the XRPL. Prove it and settle this invoice."
          : "The deadline has passed with no matching payment. Prove the absence and mark it."}
      </p>

      <button onClick={run} disabled={running || !signer}>
        {running ? "Working…" : canSettle ? "Prove payment & settle" : "Prove absence & mark"}
      </button>

      {running && (
        <>
          <p className="dim">{STAGE_TEXT[stage!]} {detail && <span className="mono">({detail})</span>}</p>
          <p className="dim">
            A Data Connector round takes about {TIMING.fdcRound}s. Leave this tab open.
          </p>
        </>
      )}

      {txHash && <p className="status-settled mono">Recorded in {txHash.slice(0, 18)}…</p>}
      {error && <p className="error">{error}</p>}
      {!signer && <p className="dim">Connect a wallet to do this — it costs a little C2FLR in gas.</p>}
    </div>
  );
}
