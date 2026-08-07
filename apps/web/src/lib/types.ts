/**
 * The shapes the contracts return, as the UI sees them.
 *
 * `bigint` throughout for anything that is a uint on-chain — do not narrow to
 * `number` in the data layer. Convert at the point of display, where you know
 * the unit.
 */

export enum InvoiceStatus {
  None = 0,
  Open = 1,
  Settled = 2,
  Delinquent = 3,
}

/**
 * The UI-level status. `Lapsed` is not an on-chain state: it is an Open invoice
 * whose deadline has passed and whose delinquency proof is still being produced.
 * That window is ~2 minutes and showing it as "open" reads as a bug.
 */
export type DisplayStatus = "open" | "lapsed" | "settled" | "delinquent";

export interface Invoice {
  id: bigint;
  issuer: string;
  destinationTag: number;
  status: InvoiceStatus;
  payeeAddressHash: string;
  amountDrops: bigint;
  minimalBlockNumber: bigint;
  deadlineBlockNumber: bigint;
  deadlineTimestamp: bigint;
  /** Zero hash means a bearer invoice: anyone may settle it, and a lapse marks nobody. */
  payerAddressHash: string;
  /**
   * Whether the named debtor has admitted this debt. Anyone may *name* a payer, so an
   * unacknowledged invoice can still be marked delinquent — but the mark reaches no
   * payment record. Surface this: an unacknowledged mark is a claim, not a judgement.
   */
  acknowledged: boolean;
  /**
   * Native FLR locked against this obligation, in wei. Settlement returns it to the
   * poster; a mark hands it to the issuer. A bonded invoice is the only kind whose
   * outcome moves money, which is what makes it matter without anyone else reading
   * the registry.
   */
  bondAmount: bigint;
  /** Who gets it back on settlement — not necessarily the payer; guarantors are allowed. */
  bondPoster: string;
  settledByAddressHash: string;
  outcomeTimestamp: bigint;
  metadataURI: string;
}

export interface PayerRecord {
  settledCount: bigint;
  delinquentCount: bigint;
  settledDrops: bigint;
  delinquentDrops: bigint;
  lastOutcomeTimestamp: bigint;
}

export type ScoreBand = "none" | "poor" | "fair" | "good" | "excellent";

/**
 * What the TEE returns. Note what is absent: no counts, no amounts, no dates.
 * A caller learns the account's creditworthiness and cannot reconstruct the
 * history behind it.
 */
export interface Score {
  /** 300–850, or 0 meaning "no attested history" — render that as "no record". */
  score: number;
  band: ScoreBand;
  /** How many attested outcomes back the score. Always show this. */
  basis: number;
  version: string;
}

/** Stages of an outcome, for the pipeline display. */
export type PipelineStage =
  | "awaiting_payment"
  | "payment_seen"
  | "deadline_passed"
  | "proving"
  | "settled"
  | "delinquent";

export interface Pipeline {
  stage: PipelineStage;
  /** XRPL transaction hash, once a matching payment is visible. */
  xrplTxHash?: string;
  /** Seconds until the deadline; negative once past. */
  secondsToDeadline: number;
}
