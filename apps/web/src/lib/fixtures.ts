/**
 * Fixtures for every state, including ones that are slow or impossible to
 * trigger by hand (a lapsed-but-not-yet-proved invoice lasts ~2 minutes; a
 * strong payment record would take a day of invoices to build).
 *
 * Build screens against these first. `?fixtures=1` in the URL switches the whole
 * app onto them — see `useFixtures()`.
 */
import { InvoiceStatus, type Invoice, type PayerRecord, type Score } from "./types";
import { ZERO_HASH } from "./format";

/** From the live end-to-end run on Coston2 — these are real values. */
export const LIVE = {
  payeeAddress: "rLthLtDGxNQSTz3m2uYWmM891gpHqBe7fs",
  payeeHash: "0x49ed1d1fbbb168b407d0836c6b3f900bc2551f017ae28f183c6ae3c41ec56b29",
  payerAddress: "rnhHC8ST7RtksLBVmLTRQZ7CvcigJQprQt",
  payerHash: "0xfc2000c1cc37efcc6cad8046042a9c81f79fd59b8c80dba6a5517a7334fbf4fc",
  issuer: "0x56c72d45C14acc183D42f0eB3B5A6A484531D091",
} as const;

const now = () => Math.floor(Date.now() / 1000);

const base = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 1n,
  issuer: LIVE.issuer,
  destinationTag: 1,
  status: InvoiceStatus.Open,
  payeeAddressHash: LIVE.payeeHash,
  amountDrops: 10_000_000n,
  minimalBlockNumber: 19_625_845n,
  deadlineBlockNumber: 19_626_145n,
  deadlineTimestamp: BigInt(now() + 600),
  payerAddressHash: LIVE.payerHash,
  acknowledged: true,
  bondAmount: 0n,
  bondPoster: "0x0000000000000000000000000000000000000000",
  settledByAddressHash: ZERO_HASH,
  outcomeTimestamp: 0n,
  metadataURI: "",
  ...overrides,
});

export const invoices = {
  /** Open, ten minutes left. */
  open: () => base(),

  /** Open with seconds left — for testing countdown urgency states. */
  expiringSoon: () => base({ id: 2n, destinationTag: 2, deadlineTimestamp: BigInt(now() + 25) }),

  /**
   * Deadline passed, still Open on-chain: the delinquency proof is in flight.
   * This is the state most likely to be rendered wrong.
   */
  lapsed: () => base({ id: 3n, destinationTag: 3, deadlineTimestamp: BigInt(now() - 30) }),

  settled: () =>
    base({
      id: 4n,
      destinationTag: 4,
      status: InvoiceStatus.Settled,
      amountDrops: 5_000_000n,
      settledByAddressHash: LIVE.payerHash,
      outcomeTimestamp: BigInt(now() - 300),
    }),

  delinquent: () =>
    base({
      id: 5n,
      destinationTag: 5,
      status: InvoiceStatus.Delinquent,
      amountDrops: 7_000_000n,
      outcomeTimestamp: BigInt(now() - 120),
    }),

  /** No named debtor: anyone may settle it, and a lapse marks nobody. */
  bearer: () => base({ id: 6n, destinationTag: 6, payerAddressHash: ZERO_HASH }),

  /** A long amount, to check number formatting doesn't break the layout. */
  large: () => base({ id: 7n, destinationTag: 7, amountDrops: 1_234_567_890_123n }),

  /**
   * A debt the named payer never admitted. Anyone can write an invoice naming
   * anyone, so this can still be marked — but it reaches no payment record, and
   * the UI must say so rather than presenting it as a judgement.
   */
  unacknowledged: () =>
    base({ id: 8n, destinationTag: 8, acknowledged: false, amountDrops: 1_000_000_000n }),

  /** Bonded and open — the payer has real money riding on the deadline. */
  bonded: () =>
    base({
      id: 10n,
      destinationTag: 10,
      bondAmount: 5_000_000_000_000_000_000n, // 5 FLR
      bondPoster: LIVE.issuer,
    }),

  /** Bonded and missed: the mark handed the bond to the creditor. */
  bondForfeited: () =>
    base({
      id: 11n,
      destinationTag: 11,
      status: InvoiceStatus.Delinquent,
      bondAmount: 0n, // cleared on resolution; BondResolved carries the amount
      bondPoster: LIVE.issuer,
      outcomeTimestamp: BigInt(now() - 90),
    }),

  /** Marked, but never acknowledged: a claim, not a judgement. */
  unacknowledgedMark: () =>
    base({
      id: 9n,
      destinationTag: 9,
      status: InvoiceStatus.Delinquent,
      acknowledged: false,
      amountDrops: 1_000_000_000n,
      outcomeTimestamp: BigInt(now() - 60),
    }),
};

export const list = (): Invoice[] => [
  invoices.expiringSoon(),
  invoices.lapsed(),
  invoices.settled(),
  invoices.delinquent(),
  invoices.bearer(),
  invoices.open(),
  invoices.large(),
  invoices.unacknowledged(),
  invoices.unacknowledgedMark(),
  invoices.bonded(),
  invoices.bondForfeited(),
];

export const records: Record<string, PayerRecord> = {
  /** No attested history. Render as "no record", NOT "clean record". */
  empty: {
    settledCount: 0n,
    delinquentCount: 0n,
    settledDrops: 0n,
    delinquentDrops: 0n,
    lastOutcomeTimestamp: 0n,
  },
  /** The real record on Coston2 right now. */
  live: {
    settledCount: 1n,
    delinquentCount: 1n,
    settledDrops: 5_000_000n,
    delinquentDrops: 7_000_000n,
    lastOutcomeTimestamp: 1_785_843_351n,
  },
  strong: {
    settledCount: 14n,
    delinquentCount: 0n,
    settledDrops: 1_400_000_000n,
    delinquentDrops: 0n,
    lastOutcomeTimestamp: BigInt(now() - 86_400),
  },
  poor: {
    settledCount: 2n,
    delinquentCount: 9n,
    settledDrops: 20_000_000n,
    delinquentDrops: 900_000_000n,
    lastOutcomeTimestamp: BigInt(now() - 3_600),
  },
};

export const scores: Record<string, Score> = {
  /** score 0 means no history — render as "no record", not a zero score. */
  none: { score: 0, band: "none", basis: 0, version: "quittance-score-1" },
  /** One outcome. The `basis` is what stops this reading as a real judgement. */
  thin: { score: 546, band: "poor", basis: 1, version: "quittance-score-1" },
  /** Computed by the real enclave from the live Coston2 record. */
  live: { score: 516, band: "poor", basis: 2, version: "quittance-score-1" },
  good: { score: 702, band: "good", basis: 8, version: "quittance-score-1" },
  excellent: { score: 828, band: "excellent", basis: 14, version: "quittance-score-1" },
};

/** Flip the whole app onto fixtures with `?fixtures=1`. */
export const useFixtures = (): boolean =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("fixtures");
