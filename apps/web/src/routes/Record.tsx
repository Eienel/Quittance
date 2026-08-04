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
        <div className="stub">
          <p><b>No record</b></p>
          <p className="dim">
            No attested outcomes for this account. Not the same as a clean record.
          </p>
        </div>
      )}

      {data && !empty && (
        <div className="stub">
          <p className="status-settled">
            {data.settledCount.toString()} settled ({formatXrp(data.settledDrops)} XRP)
          </p>
          <p className="status-delinquent">
            {data.delinquentCount.toString()} delinquent ({formatXrp(data.delinquentDrops)} XRP)
          </p>
          <p className="dim">Last outcome {formatTimestamp(data.lastOutcomeTimestamp)}</p>
        </div>
      )}
    </section>
  );
}
