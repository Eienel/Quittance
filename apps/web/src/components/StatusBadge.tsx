import type { DisplayStatus } from "@/lib/types";

/**
 * The four states must stay visually distinct - especially `lapsed`, which is
 * an invoice whose deadline has passed but whose proof is still in flight.
 * Collapsing it into `open` makes a working system look stuck.
 */
const LABEL: Record<DisplayStatus, string> = {
  open: "open",
  lapsed: "lapsed · proving",
  settled: "settled ✓",
  delinquent: "delinquent ✗",
};

export default function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={`badge status-${status}`}>{LABEL[status]}</span>;
}
