import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import type { useWallet } from "@/hooks/useWallet";
import { createInvoice, errorMessage } from "@/lib/registry";
import { deadlineFromMinutes } from "@/lib/xrpl";
import { remember } from "@/lib/addressBook";
import { looksLikeXrplAddress, xrpToDrops, ZERO_HASH } from "@/lib/format";
import { encodeMeta } from "@/lib/metadata";

type Wallet = ReturnType<typeof useWallet>;

export default function Create() {
  const wallet = useOutletContext<Wallet>();
  const navigate = useNavigate();

  const [payee, setPayee] = useState("");
  const [payer, setPayer] = useState("");
  const [bearer, setBearer] = useState(false);
  const [xrp, setXrp] = useState("10");
  const [minutes, setMinutes] = useState("10");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = looksLikeXrplAddress(payee) && (bearer || looksLikeXrplAddress(payer)) && Number(xrp) > 0;

  async function submit() {
    if (!wallet.signer) return setError("Connect a wallet first.");
    setBusy(true);
    setError(null);
    try {
      // Both a ledger index and a timestamp — the FDC window is bounded by each.
      const deadline = await deadlineFromMinutes(Number(minutes));
      const { invoiceId } = await createInvoice(wallet.signer, {
        payeeAddressHash: remember(payee),
        payerAddressHash: bearer ? ZERO_HASH : remember(payer),
        amountDrops: xrpToDrops(xrp),
        ...deadline,
        // Publish the payee address so a shared invoice link is payable by
        // someone who has never seen it. The chain stores only its hash.
        metadataURI: encodeMeta({ payee, memo: memo || undefined }),
      });
      navigate(`/invoice/${invoiceId}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Create invoice</h2>

      <label>Payee XRPL address (gets paid)</label>
      <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="r…" />

      <label>
        <input
          type="checkbox"
          checked={bearer}
          onChange={(e) => setBearer(e.target.checked)}
          style={{ width: "auto", marginRight: ".4rem" }}
        />
        Bearer invoice — anyone may settle it
      </label>
      {bearer ? (
        <p className="dim">
          No named debtor, so a lapse marks nobody&apos;s record. Deliberate choice, not a
          blank field.
        </p>
      ) : (
        <>
          <label>Payer XRPL address (the debtor)</label>
          <input value={payer} onChange={(e) => setPayer(e.target.value)} placeholder="r…" />
        </>
      )}

      <div className="row">
        <div>
          <label>Amount (XRP)</label>
          <input type="number" min="0.000001" step="any" value={xrp} onChange={(e) => setXrp(e.target.value)} />
        </div>
        <div>
          <label>Deadline (minutes from now)</label>
          <input type="number" min="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
      </div>

      <label>Description (optional, stored on-chain)</label>
      <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Invoice for…" />

      <p style={{ marginTop: ".9rem" }}>
        <button onClick={submit} disabled={!valid || busy || !wallet.address}>
          {busy ? "Issuing…" : "Issue invoice"}
        </button>
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
