import { useOutletContext, useParams } from "react-router-dom";
import { useInvoice } from "@/hooks/useInvoices";
import { usePipeline } from "@/hooks/usePipeline";
import { resolve } from "@/lib/addressBook";
import { displayStatus, formatXrp, formatTimestamp, isBearer, truncate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import PayInstructions from "@/components/PayInstructions";
import Pipeline from "@/components/Pipeline";
import OutcomeAction from "@/components/OutcomeAction";
import BondPanel from "@/components/BondPanel";
import { verifyPayee, decodeMeta } from "@/lib/metadata";
import { framingFor } from "@/lib/obligations";
import type { useWallet } from "@/hooks/useWallet";

type Wallet = ReturnType<typeof useWallet>;

export default function InvoiceDetail() {
  const { id } = useParams();
  const wallet = useOutletContext<Wallet>();
  const { data: invoice, loading, error, refresh } = useInvoice(id ? BigInt(id) : null);

  // The issuer publishes the payee address in the invoice metadata, so a shared
  // link is payable by someone who has never seen it. verifyPayee re-hashes the
  // claim and only accepts it if it matches what the contract enforces; the
  // local address book is the fallback for invoices issued before that.
  const payeeAddress = invoice
    ? verifyPayee(invoice, resolve(invoice.payeeAddressHash))
    : null;
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

      {(status === "open" || status === "lapsed") && payeeAddress && (
        <PayInstructions invoice={invoice} payeeAddress={payeeAddress} />
      )}
      {status === "open" && !payeeAddress && (
        <p className="dim">
          This invoice did not publish its payee address, and this browser has not
          seen it, so pay instructions cannot be shown. The chain stores only a hash.
        </p>
      )}

      <BondPanel invoice={invoice} signer={wallet.signer} onDone={refresh} />

      <OutcomeAction
        invoice={invoice}
        pipeline={pipeline}
        signer={wallet.signer}
        onDone={refresh}
      />

      <table>
        <tbody>
          <tr><th>Destination tag</th><td className="mono">{invoice.destinationTag}</td></tr>
          <tr><th>Amount</th><td>{formatXrp(invoice.amountDrops)} XRP</td></tr>
          <tr><th>Deadline</th><td>{formatTimestamp(invoice.deadlineTimestamp)}</td></tr>
          <tr>
            <th>Payer</th>
            <td className="mono">
              {isBearer(invoice)
                ? "bearer · anyone may settle"
                : resolve(invoice.payerAddressHash) ?? truncate(invoice.payerAddressHash, 10, 6)}
            </td>
          </tr>
          <tr>
            <th>Ledger window</th>
            <td className="mono">
              {invoice.minimalBlockNumber.toString()} – {invoice.deadlineBlockNumber.toString()}
            </td>
          </tr>
          <tr><th>Kind</th><td>{framingFor(decodeMeta(invoice.metadataURI).kind).label}</td></tr>
          {decodeMeta(invoice.metadataURI).memo && (
            <tr><th>Description</th><td>{decodeMeta(invoice.metadataURI).memo}</td></tr>
          )}
          {invoice.outcomeTimestamp > 0n && (
            <tr><th>Outcome at</th><td>{formatTimestamp(invoice.outcomeTimestamp)}</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
