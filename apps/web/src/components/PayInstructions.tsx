import { dropsToXrp, xrplPaymentUri } from "@/lib/format";
import type { Invoice } from "@/lib/types";
import Countdown from "./Countdown";

/**
 * The screen a payer actually uses, and the one most worth designing well.
 *
 * Non-negotiable: the destination tag has to be the most prominent, most
 * copyable thing here. A payment sent without it cannot be matched to the
 * invoice, the invoice still lapses, and the payer's money is gone to the payee
 * with no record of what it settled. That is the single most likely way a live
 * demo fails.
 *
 * TODO(design): QR code from `uri` below. Any QR library works — it encodes the
 * standard XRPL payment URI, which most wallets parse into a prefilled send.
 */
export default function PayInstructions({
  invoice,
  payeeAddress,
}: {
  invoice: Invoice;
  /** Not derivable from the invoice — it stores only a hash. */
  payeeAddress: string;
}) {
  const uri = xrplPaymentUri(payeeAddress, invoice.amountDrops, invoice.destinationTag);

  const copy = (text: string) => void navigator.clipboard?.writeText(text);

  return (
    <div className="stub">
      <p className="dim">Payable from any XRPL wallet or exchange — nothing to install.</p>

      <p>
        Send <b>{dropsToXrp(invoice.amountDrops)} XRP</b> to:
      </p>
      <p className="mono">
        {payeeAddress} <button onClick={() => copy(payeeAddress)}>copy</button>
      </p>

      <p style={{ marginTop: "1rem" }}>with destination tag:</p>
      <p>
        <b className="mono" style={{ fontSize: "2rem" }}>
          {invoice.destinationTag}
        </b>{" "}
        <button onClick={() => copy(String(invoice.destinationTag))}>copy</button>
      </p>

      <p className="error" style={{ marginTop: "1rem" }}>
        Without this tag the payment cannot be matched and the invoice will still
        be marked delinquent.
      </p>

      <p className="dim" style={{ marginTop: "1rem" }}>
        Time remaining: <Countdown deadlineTimestamp={invoice.deadlineTimestamp} />
      </p>

      {/* TODO(design): render this as a QR code instead of a link. */}
      <p className="dim mono">{uri}</p>
    </div>
  );
}
