/**
 * What we put in an invoice's `metadataURI`.
 *
 * The registry stores only `keccak256(payeeAddress)`, which is one-way — so an
 * invoice fetched cold cannot tell you where to send the money. That is fine for
 * the issuer, who typed the address, and fatal for everyone else: a payer opening
 * a shared link would see an invoice with no payable address.
 *
 * So the issuer publishes the payee address in the free-form metadata field. It
 * is not sensitive (it is a receiving address, already public on the XRPL) and it
 * is not trusted for anything — `verifyPayee` re-hashes it and checks it against
 * the invoice before the UI shows it. A tampered value simply fails to match.
 */
import { addressHash } from "./format";
import type { Invoice } from "./types";

export interface InvoiceMeta {
  /** XRPL classic address to be paid. */
  payee?: string;
  /** Free-form human description. */
  memo?: string;
}

export function encodeMeta(meta: InvoiceMeta): string {
  const clean: InvoiceMeta = {};
  if (meta.payee) clean.payee = meta.payee.trim();
  if (meta.memo) clean.memo = meta.memo.trim();
  return Object.keys(clean).length ? JSON.stringify(clean) : "";
}

export function decodeMeta(metadataURI: string): InvoiceMeta {
  const raw = metadataURI?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        payee: typeof parsed.payee === "string" ? parsed.payee : undefined,
        memo: typeof parsed.memo === "string" ? parsed.memo : undefined,
      };
    }
  } catch {
    // Older invoices (and hand-made ones) may hold a bare address or a plain URI.
    if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(raw)) return { payee: raw };
    return { memo: raw };
  }
  return {};
}

/**
 * The payee address for an invoice, or null if we cannot establish one.
 *
 * Never trusts the metadata: the address is only returned when its hash equals
 * the `payeeAddressHash` the contract actually enforces. `fallback` lets a caller
 * pass an address the user typed or one from the local address book.
 */
export function verifyPayee(invoice: Invoice, fallback?: string | null): string | null {
  const candidates = [decodeMeta(invoice.metadataURI).payee, fallback].filter(
    (c): c is string => !!c
  );
  for (const candidate of candidates) {
    try {
      if (addressHash(candidate) === invoice.payeeAddressHash) return candidate;
    } catch {
      // Not a usable address; try the next candidate.
    }
  }
  return null;
}
