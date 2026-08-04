import { useParams } from "react-router-dom";
import { useInvoice } from "@/hooks/useInvoices";
import { usePipeline } from "@/hooks/usePipeline";
import { resolve } from "@/lib/addressBook";
import { displayStatus, formatXrp, formatTimestamp, isBearer, truncate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import PayInstructions from "@/components/PayInstructions";
import Pipeline from "@/components/Pipeline";

export default function InvoiceDetail() {
  const { id } = useParams();
  const { data: invoice, loading, error } = useInvoice(id ? BigInt(id) : null);

  // The chain stores only a hash, so a friendly address is available exactly
  // when we have seen it before. Without it we cannot watch the XRPL.
  const payeeAddress = invoice ? resolve(invoice.payeeAddressHash) : null;
  const pipeline = usePipeline(invoice, payeeAddress);

  if (loading) return <section><p className="dim">Loading…</p></section>;
  if (error) return <section><p className="error">{error}</p></section>;
  if (!invoice) return null;

  const status = displayStatus(invoice);

  return (
    <section>
      <h2>
        Invoice #{invoice.id.toString()} <StatusBadge status={status} />
      </h2>

      <Pipeline pipeline={pipeline} />

      {status === "open" && payeeAddress && (
        <PayInstructions invoice={invoice} payeeAddress={payeeAddress} />
      )}
      {status === "open" && !payeeAddress && (
        <p className="dim">
          Payee address unknown to this browser (the chain stores only a hash), so
          pay instructions cannot be shown. Open the invoice from the device that
          created it, or look it up by address.
        </p>
      )}

      <table>
        <tbody>
          <tr><th>Destination tag</th><td className="mono">{invoice.destinationTag}</td></tr>
          <tr><th>Amount</th><td>{formatXrp(invoice.amountDrops)} XRP</td></tr>
          <tr><th>Deadline</th><td>{formatTimestamp(invoice.deadlineTimestamp)}</td></tr>
          <tr>
            <th>Payer</th>
            <td className="mono">
              {isBearer(invoice)
                ? "bearer — anyone may settle"
                : resolve(invoice.payerAddressHash) ?? truncate(invoice.payerAddressHash, 10, 6)}
            </td>
          </tr>
          <tr>
            <th>Ledger window</th>
            <td className="mono">
              {invoice.minimalBlockNumber.toString()} – {invoice.deadlineBlockNumber.toString()}
            </td>
          </tr>
          {invoice.outcomeTimestamp > 0n && (
            <tr><th>Outcome at</th><td>{formatTimestamp(invoice.outcomeTimestamp)}</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
