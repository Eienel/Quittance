import { useState } from "react";
import { usePayerRecord } from "@/hooks/useInvoices";
import { remember } from "@/lib/addressBook";
import { formatXrp, formatTimestamp, looksLikeXrplAddress } from "@/lib/format";

/**
 * The lender's view: what a counterparty sees before extending credit.
 *
 * A delinquency here is permanent and network-attested. Nobody can retract it,
 * including the issuer — that permanence is the value proposition and the copy
 * should say so.
 */
export default function Record() {
  const [input, setInput] = useState("");
  const [hash, setHash] = useState<string | null>(null);
  const { data, loading, error } = usePayerRecord(hash);

  const lookup = () => {
    if (!looksLikeXrplAddress(input)) return;
    setHash(remember(input));
  };

  const empty = data && data.settledCount === 0n && data.delinquentCount === 0n;

  return (
    <section>
      <h2>Payment record</h2>
      <p className="dim">The permanent, network-attested history of one XRPL account.</p>

      <div className="row">
        <div>
          <label>XRPL address</label>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="r…" />
        </div>
        <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
          <button onClick={lookup} disabled={!looksLikeXrplAddress(input)}>Look up</button>
        </div>
      </div>

      {loading && hash && <p className="dim">Reading…</p>}
      {error && <p className="error">{error}</p>}

      {empty && (
        <div style={{ marginTop: "1.1rem" }}>
          <p style={{ margin: 0, fontWeight: 600, color: "var(--ink)" }}>No record</p>
          <p className="dim" style={{ marginTop: "0.3rem" }}>
            No attested outcomes for this account. <b>Not</b> the same as a clean record.
            A lender sees the absence of history, not proof of good standing.
          </p>
        </div>
      )}

      {data && !empty && (
        <>
          <div className="outcomes">
            <div className="outcome-card settled">
              <div className="n">{data.settledCount.toString()}</div>
              <div className="k">Quittances · settled</div>
              <div className="sub">{formatXrp(data.settledDrops)} XRP paid on time</div>
            </div>
            <div className="outcome-card delinquent">
              <div className="n">{data.delinquentCount.toString()}</div>
              <div className="k">Marks · delinquent</div>
              <div className="sub">{formatXrp(data.delinquentDrops)} XRP proven unpaid</div>
            </div>
          </div>
          <p className="dim small" style={{ marginTop: "0.8rem" }}>
            Last outcome {formatTimestamp(data.lastOutcomeTimestamp)}. Every entry is
            network-attested and permanent. No one can retract it, including the issuer.
          </p>
        </>
      )}
    </section>
  );
}
