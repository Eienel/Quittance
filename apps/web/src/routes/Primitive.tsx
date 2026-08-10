import { OBLIGATIONS } from "@/lib/obligations";
import { CONTRACTS } from "@/lib/config";

/**
 * The argument that this is a primitive, not an invoicing app.
 *
 * One registry, one set of contract calls, many obligations. The page lays the
 * kinds side by side against the same three operations so the invariance is
 * visible: what changes is only who the parties are and what the deadline means.
 *
 * TODO(design): this is the conceptual centerpiece. Consider a single row of
 * three operations across the top (issue · prove met · prove missed) and the
 * obligation kinds as columns beneath, so the eye reads "same mechanism, four
 * uses" before reading any words.
 */
export default function Primitive() {
  return (
    <section>
      <h2>One primitive, many obligations</h2>
      <p className="dim">
        Quittance is not an invoicing app. It is one registry that turns any
        deadline-shaped obligation into a proved outcome. Every kind below is the
        same three contract calls at{" "}
        <span className="mono">{CONTRACTS.invoiceRegistry.slice(0, 10)}…</span>. The
        contract does not know a coupon from an invoice.
      </p>

      <div className="stub">
        <table>
          <thead>
            <tr>
              <th>Operation</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">createInvoice</td>
              <td>issue the obligation, fixing its terms and deadline</td>
            </tr>
            <tr>
              <td className="mono">settle</td>
              <td>prove, with an <span className="mono">XRPPayment</span> attestation, that it was met</td>
            </tr>
            <tr>
              <td className="mono">markDelinquent</td>
              <td>prove, with an <span className="mono">XRPPaymentNonexistence</span> attestation, that it was missed</td>
            </tr>
            <tr>
              <td className="mono">postBond</td>
              <td>optionally stake FLR, which the outcome moves</td>
            </tr>
          </tbody>
        </table>
        <p className="dim">
          The three that decide an outcome are the same for every obligation on this
          page. Only the parties and the meaning of the deadline change.
        </p>
      </div>

      {OBLIGATIONS.map((o) => (
        <div className="stub" key={o.kind}>
          <p>
            <b>{o.label}</b>{" "}
            <span className={`badge ${o.status === "live" ? "status-settled" : "status-lapsed"}`}>
              {o.status === "live" ? "live on Coston2" : "same mechanism"}
            </span>
          </p>
          <p>{o.summary}</p>
          <table>
            <tbody>
              <tr><th>Obligor</th><td>{o.obligor}</td></tr>
              <tr><th>Obligee</th><td>{o.obligee}</td></tr>
              <tr><th>Quittance means</th><td className="status-settled">{o.met}</td></tr>
              <tr><th>Mark means</th><td className="status-delinquent">{o.missed}</td></tr>
              <tr><th>Bond</th><td>{o.bond}</td></tr>
            </tbody>
          </table>
          {o.note && <p className="dim">{o.note}</p>}
        </div>
      ))}

      <p className="dim">
        The strength of a primitive is that one mechanism serves many uses. Invoices
        are the first thing we pointed it at; FAssets already uses the same
        proof-of-absence for redemption defaults. Everything here runs on the one
        registry; nothing above required a second contract.
      </p>
    </section>
  );
}
