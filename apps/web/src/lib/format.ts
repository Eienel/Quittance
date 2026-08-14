import { ethers } from "ethers";
import { InvoiceStatus, type DisplayStatus, type Invoice } from "./types";

/** 1 XRP = 1,000,000 drops. */
export const DROPS_PER_XRP = 1_000_000n;

export const dropsToXrp = (drops: bigint): number => Number(drops) / 1e6;

export const xrpToDrops = (xrp: number | string): bigint => {
  const n = typeof xrp === "string" ? Number(xrp) : xrp;
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid XRP amount: ${xrp}`);
  return BigInt(Math.round(n * 1e6));
};

export const formatXrp = (drops: bigint, maxFractionDigits = 6): string =>
  dropsToXrp(drops).toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });

/**
 * The FDC "standard address hash": keccak256 of the classic address string.
 *
 * This is one-way. You cannot turn a hash back into an `r...` address, which is
 * why the app keeps an address book (see addressBook.ts) rather than pretending
 * it can resolve them.
 */
export const addressHash = (xrplAddress: string): string =>
  ethers.keccak256(ethers.toUtf8Bytes(xrplAddress.trim()));

export const ZERO_HASH = ethers.ZeroHash;

export const isBearer = (inv: Invoice): boolean => inv.payerAddressHash === ZERO_HASH;

/** Loose check - enough to catch typos before a transaction, not a full validation. */
export const looksLikeXrplAddress = (s: string): boolean =>
  /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(s.trim());

export const truncate = (s: string, lead = 6, tail = 4): string =>
  s.length <= lead + tail + 1 ? s : `${s.slice(0, lead)}…${s.slice(-tail)}`;

/**
 * Map on-chain status to what the UI should show.
 *
 * The interesting case is an Open invoice past its deadline: on-chain it is
 * still Open, but its outcome is already determined - the delinquency proof is
 * just being produced. Showing that as "open" makes a working system look stuck.
 */
export function displayStatus(inv: Invoice, nowUnix = Math.floor(Date.now() / 1000)): DisplayStatus {
  switch (inv.status) {
    case InvoiceStatus.Settled:
      return "settled";
    case InvoiceStatus.Delinquent:
      return "delinquent";
    case InvoiceStatus.Open:
      return nowUnix > Number(inv.deadlineTimestamp) ? "lapsed" : "open";
    default:
      return "open";
  }
}

export const secondsToDeadline = (inv: Invoice, nowUnix = Math.floor(Date.now() / 1000)): number =>
  Number(inv.deadlineTimestamp) - nowUnix;

/** "2h 14m", "4m 03s", "past" - for countdowns. */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "past";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export const formatTimestamp = (unix: bigint | number): string =>
  Number(unix) === 0 ? "-" : new Date(Number(unix) * 1000).toLocaleString();

/**
 * The XRPL payment URI most wallets understand. Amount is in XRP, `dt` is the
 * destination tag - the one field that must not be lost.
 */
export const xrplPaymentUri = (payeeAddress: string, drops: bigint, destinationTag: number): string =>
  `ripple:${payeeAddress}?amount=${dropsToXrp(drops)}&dt=${destinationTag}`;
