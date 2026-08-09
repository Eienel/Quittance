import { useState } from "react";
import { ethers } from "ethers";
import { postBond, errorMessage } from "@/lib/registry";
import { displayStatus } from "@/lib/format";
import type { Invoice } from "@/lib/types";
import type { ethers as Ethers } from "ethers";

/**
 * The bond — the thing that makes an outcome matter.
 *
 * Without it, a delinquency mark is a statement: true, permanent, and consequential
 * only if some third party ever reads the registry. With it, the same attestation
 * that records the mark hands the money to the creditor. That works on the very
 * first invoice, between two parties, with nobody else involved.
 *
 * TODO(design): this is the most demo-critical screen after the pay instructions.
 * A judge watching FLR actually move on a missed deadline is the whole pitch in one
 * shot. Consider showing the two futures side by side — "paid: returned to you" vs
 * "missed: goes to the issuer" — so the stake is legible before the deadline, not
 * only after.
 */
export default function BondPanel({
  invoice,
  signer,
  onDone,
}: {
  invoice: Invoice;
  signer: Ethers.Signer | null;
  onDone?: () => void;
}) {
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = displayStatus(invoice);
  const decided = status === "settled" || status === "delinquent";
  const hasBond = invoice.bondAmount > 0n;

  async function submit() {
    if (!signer) return setError("Connect a wallet to post a bond.");
    setBusy(true);
    setError(null);
    try {
      await postBond(signer, invoice.id, ethers.parseEther(amount));
      onDone?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (decided) {
    // After resolution bondAmount is zeroed; the BondResolved event carries where it went.
    return hasBond ? null : (
      <div className="stub">
        <p className="dim">
          {status === "settled"
            ? "Obligation met — any bond was returned to whoever posted it."
            : "Obligation broken — any bond went to the issuer."}
        </p>
      </div>
    );
  }

  return (
    <div className="stub">
      {hasBond ? (
        <>
          <p>
            <b>{ethers.formatEther(invoice.bondAmount)} FLR</b> is riding on this deadline.
          </p>
          <p className="dim">
            Paid on time, it returns to {invoice.bondPoster.slice(0, 8)}…. Missed, it goes to
            the issuer — released by the same proof that records the mark.
          </p>
        </>
      ) : (
        <p className="dim">
          No bond posted. The outcome will be proved either way, but nothing moves — the mark
          would be a statement rather than a consequence.
        </p>
      )}

      <label>Post a bond (FLR)</label>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="any" />
      <p>
        <button onClick={submit} disabled={busy || !signer}>
          {busy ? "Posting…" : hasBond ? "Top up bond" : "Post bond"}
        </button>
      </p>

      {error && <p className="error">{error}</p>}
      {!signer && <p className="dim">Connect a wallet to post a bond.</p>}
    </div>
  );
}
