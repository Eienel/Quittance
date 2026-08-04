import { Link } from "react-router-dom";
import { useInvoiceList } from "@/hooks/useInvoices";
import { displayStatus, formatXrp, formatTimestamp } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import Countdown from "@/components/Countdown";

export default function Invoices() {
  const { data, loading, error } = useInvoiceList();

  return (
    <section>
      <h2>Invoices</h2>
      {loading && <p className="dim">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && <p className="dim">No invoices yet.</p>}
      {data && data.length > 0 && (
        <table>
          <thead>
            <tr><th>#</th><th>Tag</th><th>XRP</th><th>Deadline</th><th>Status</th></tr>
          </thead>
          <tbody>
            {data.map((inv) => {
              const status = displayStatus(inv);
              return (
                <tr key={inv.id.toString()}>
                  <td><Link to={`/invoice/${inv.id}`}>{inv.id.toString()}</Link></td>
                  <td className="mono">{inv.destinationTag}</td>
                  <td>{formatXrp(inv.amountDrops)}</td>
                  <td>
                    {status === "open"
                      ? <Countdown deadlineTimestamp={inv.deadlineTimestamp} />
                      : formatTimestamp(inv.deadlineTimestamp)}
                  </td>
                  <td><StatusBadge status={status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
