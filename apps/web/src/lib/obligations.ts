import type { ObligationKind } from "./types";

/**
 * The same three contract calls, wearing the clothes each user recognizes.
 *
 * Every field below is presentation. The registry does not know a coupon from an
 * invoice — `createInvoice` issues the obligation, `settle` proves it was met,
 * `markDelinquent` proves it was missed, and an optional bond makes the outcome
 * move money. What changes between kinds is only *who* the two parties are and
 * *what* the deadline means. That invariance is the point: one primitive, many
 * obligations.
 */
export interface ObligationFraming {
  kind: ObligationKind;
  /** What this obligation is called to the person using it. */
  label: string;
  /** One line: the shape of the commitment. */
  summary: string;
  /** Who owes. */
  obligor: string;
  /** Who is owed. */
  obligee: string;
  /** What a quittance (settle) means here. */
  met: string;
  /** What a mark (markDelinquent) means here. */
  missed: string;
  /** What the bond is, in this framing. */
  bond: string;
  /** Whether this is exercised on the live registry, or shown to prove generality. */
  status: "live" | "illustrative";
  /** Why this maps cleanly onto the same mechanism (and any honest caveat). */
  note?: string;
}

export const OBLIGATIONS: ObligationFraming[] = [
  {
    kind: "invoice",
    label: "Invoice",
    summary: "A bill payable in XRP by a deadline.",
    obligor: "the client (payer)",
    obligee: "the merchant or freelancer (payee)",
    met: "the client paid in full, on time",
    missed: "the deadline passed with no matching payment",
    bond: "the client's earnest money against the bill",
    status: "live",
    note: "The seeded registry holds settled and delinquent invoices, and a fabricated one that reaches no record.",
  },
  {
    kind: "deposit",
    label: "Bonded deposit / retainer",
    summary: "Money staked on a commitment, released by the outcome.",
    obligor: "whoever posts the stake",
    obligee: "the counterparty the commitment is to",
    met: "the committed payment arrived before the deadline",
    missed: "the commitment lapsed",
    bond: "the deposit itself — returned on completion, forfeited on default",
    status: "live",
    note: "Invoice #4 on the live registry: 2 FLR bonded, deadline missed, bond handed to the creditor by the same proof that recorded the mark.",
  },
  {
    kind: "coupon",
    label: "Coupon / tokenized-credit servicing",
    summary: "A periodic payment a debt instrument owes its holder.",
    obligor: "the note issuer",
    obligee: "the note holder",
    met: "the coupon was paid into the holder's account on schedule",
    missed: "a coupon default — network-attested, not servicer-reported",
    bond: "the issuer's guarantee, slashed on default",
    status: "illustrative",
    note: "Today a trusted servicer declares coupon defaults. This is the same mechanism FAssets uses to prove redemption defaults with a nonexistence attestation — generalized. Same contract, no change.",
  },
  {
    kind: "sla",
    label: "Recurring / SLA obligation",
    summary: "A commitment that must be met every period, or the stake pays out.",
    obligor: "the provider",
    obligee: "the customer",
    met: "the periodic payment or heartbeat landed in time",
    missed: "a missed period — silence itself produces the mark",
    bond: "the provider's SLA stake",
    status: "illustrative",
    note: "A dead-man switch: the obligation fires unless the provider acts. Honest caveat — proving service health via a heartbeat payment proves the heartbeat, not the service, so a production version needs multi-vantage attesters.",
  },
];

export const framingFor = (kind: ObligationKind = "invoice"): ObligationFraming =>
  OBLIGATIONS.find((o) => o.kind === kind) ?? OBLIGATIONS[0];
