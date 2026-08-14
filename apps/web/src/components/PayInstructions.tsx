import { QRCodeSVG } from "qrcode.react";
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
 * TODO(design): QR code from `uri` below. Any QR library works - it encodes the
 * standard XRPL payment URI, which most wallets parse into a prefilled send.
 */
export default function PayInstructions({
  invoice,
  payeeAddress,
}: {
  invoice: Invoice;
  /** Not derivable from the invoice - it stores only a hash. */
  payeeAddress: string;
}) {
  const uri = xrplPaymentUri(payeeAddress, invoice.amountDrops, invoice.destinationTag);

  const copy = (text: string) => void navigator.clipboard?.writeText(text);

  return (
    <div>
      <h3>Pay this invoice</h3>
      <p className="dim" style={{ marginTop: 0 }}>
        Payable from any XRPL wallet or exchange. Nothing to install.
      </p>

      {/* 1 - amount */}
      <label>Send exactly</label>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        <span style={{ font: "700 1.6rem/1 var(--sans)", color: "var(--ink)" }}>
          {dropsToXrp(invoice.amountDrops)}
        </span>
        <span className="dim">XRP</span>
      </div>

      {/* 2 - destination address */}
      <label>To address</label>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <span className="mono" style={{ wordBreak: "break-all" }}>{payeeAddress}</span>
        <button className="copy" onClick={() => copy(payeeAddress)}>Copy</button>
      </div>

      {/* 3 - the destination tag: the hero, and the single most-missed field */}
      <div className="tag-hero">
        <div className="tag-label">Destination tag · required</div>
        <div className="tag-value">{invoice.destinationTag}</div>
        <button className="copy" onClick={() => copy(String(invoice.destinationTag))}>
          Copy tag
        </button>
      </div>

      <div className="callout">
        <span className="icon">⚠</span>
        <span>
          <b>Include the destination tag.</b> A payment sent without it can&apos;t be
          matched to this invoice. The money still reaches the payee, but the invoice
          lapses and goes to a permanent <b>Mark</b> anyway.
        </span>
      </div>

      {/* 4 - countdown + wallet URI */}
      <div className="payment-footer">
        <div>
          <p className="dim" style={{ marginTop: 0 }}>
            Time remaining · <Countdown deadlineTimestamp={invoice.deadlineTimestamp} />
          </p>
          <a className="btn" href={uri}>Open in XRPL wallet</a>
          <p className="dim small">The wallet link includes the amount and destination tag.</p>
        </div>
        <a className="payment-qr" href={uri} aria-label="Open this payment in an XRPL wallet">
          <QRCodeSVG
            value={uri}
            size={144}
            level="M"
            marginSize={2}
            title="XRPL payment QR code"
          />
          <span>Scan with an XRPL wallet</span>
        </a>
      </div>
    </div>
  );
}
