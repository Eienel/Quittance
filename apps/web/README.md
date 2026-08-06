# Quittance — web app

React + Vite + TypeScript. **The chain wiring is done and tested; the visual layer is
deliberately unfinished.** Everything inside a dashed `.stub` box is yours to replace.

```bash
cd apps/web
npm install
npm run dev                 # http://localhost:5173
npm run dev -- --open       # …and open a browser

npm run typecheck           # tsc, strict
npm test                    # unit tests (hermetic)
LIVE=1 npm test             # …plus reads against the real Coston2 registry
npm run build
```

## Start here: fixture mode

```
http://localhost:5173/?fixtures=1
```

Every screen renders from `src/lib/fixtures.ts` — no wallet, no network, no waiting. It
covers the states that are otherwise slow or impossible to produce by hand:

| Fixture | Why it exists |
| --- | --- |
| `open` | the ordinary case |
| `expiringSoon` | 25 seconds left — for urgency treatment |
| `lapsed` | deadline passed, proof in flight. **~2 min window, easy to get wrong** |
| `settled` / `delinquent` | the two terminal outcomes |
| `bearer` | no named debtor |
| `large` | 1,234,567.890123 XRP — checks number formatting |
| `records.*` | empty / live / strong / poor payment histories |
| `scores.*` | none / thin / live / good / excellent |

| `unacknowledged` | a debt the named payer never admitted |
| `unacknowledgedMark` | marked, but reaching nobody's record — a claim, not a judgement |

Drop `?fixtures=1` and the same screens read live Coston2 data. **The registry was recently
redeployed and is not yet seeded**, so expect an empty list until someone runs
`services/attester/bin/seed-demo.js`.

## What's already built

```
src/lib/
  config.ts        addresses, RPCs, timing constants
  types.ts         Invoice, PayerRecord, Score, Pipeline
  format.ts        drops↔XRP, address hashing, countdowns, status mapping
  registry.ts      all contract reads/writes + custom-error decoding
  fdc.ts           the whole attestation lifecycle, client-side (see below)
  xrpl.ts          ledger clock, deadline math, payment detection
  metadata.ts      payee address published on-chain, re-hashed before it is trusted
  addressBook.ts   localStorage hash→address (see "one-way hashes" below)
  fixtures.ts      every state, plus the real live values
src/hooks/
  useWallet.ts     connect + Coston2 add/switch
  useInvoices.ts   polled reads, fixture-aware
  usePipeline.ts   where an invoice is between issuance and outcome
```

Don't rewrite these to fetch differently — they're tested against the live chain
(`src/lib/registry.live.test.ts`). Build components on top.

## What's yours

Every `.stub` box, plus `src/styles.css` in its entirety. The routes exist and work; they're
laid out as plainly as possible so the structure is obvious and the styling isn't in your
way. Components worth the most attention, in order:

1. **`PayInstructions`** — the screen a judge actually uses.
2. **`Pipeline`** and **`OutcomeAction`** — the two-minute wait (see below).
3. **`ScorePanel`** — the privacy story.

The only thing to preserve from `styles.css` is that the four status classes stay visually
distinct: `.status-open`, `.status-lapsed`, `.status-settled`, `.status-delinquent`.

## Four things that will bite you

**1. The destination tag is the entire payer-side surface.**
A payment sent without it cannot be matched to the invoice. The invoice still lapses, and
the payer's money has gone to the payee with no record of what it settled. This is the most
likely way a live demo fails — make the tag the biggest, most copyable thing on the pay
screen and warn about it explicitly.

**2. Two minutes of latency is real and cannot be engineered away.**
XRPL finality is ~12 s; the FDC voting round is 90–180 s. So there is a ~2-minute gap
between a payer sending and a receipt appearing. The XRPL side is visible to us
immediately, so `usePipeline` can show genuine progress across that gap. A named pipeline
reads as rigor; a spinner for two minutes reads as broken.

**3. Address hashes are one-way.**
The chain stores `keccak256(xrplAddress)`, never the address. You cannot render an `r...`
address from a cold fetch. Two things cover this: the issuer publishes the payee address in
the invoice's on-chain metadata (`metadata.ts`, re-hashed and checked before it is trusted),
and `addressBook.ts` remembers every address the user types. Show the friendly name when we
have it and a truncated hash when we don't — don't fake it.

**4. An unacknowledged mark is a claim, not a judgement.**
Anyone can name anyone as the payer on an invoice. Such an invoice can still be marked
delinquent — the proof is true — but the contract deliberately keeps it out of that
account's payment record. `invoice.acknowledged` distinguishes them, and the UI must too.

**5. `score: 0` means "no record", not a score of zero.**
And always show `basis`. A 700 backed by two invoices is a different claim from a 700 backed
by forty; hiding that would be the dishonest version of that screen.

## Backend status

| | |
| --- | --- |
| Invoice reads/writes, records | **Live** on Coston2 |
| XRPL payment detection | **Live**, done client-side |
| Driving an invoice to its outcome | **Live, entirely client-side** — see below |
| Confidential score | Request path is real, but **no TEE machine is registered yet** — no score comes back. Build on `fixtures.scores` |

## There is no backend

Both Flare services the app needs — the FDC verifier and the DA layer — send
`Access-Control-Allow-Origin: *`, so `src/lib/fdc.ts` runs the entire attestation
lifecycle in the browser:

```
prepareRequest → FdcHub.requestAttestation (pays fee) → wait for voting round
→ fetch Merkle proof from DA layer → InvoiceRegistry.settle() / .markDelinquent()
```

That means **nobody has to be running a server for an invoice to settle**. Whoever has the
page open can push it through for a trivial amount of gas — `OutcomeAction` is the button.
The whole product deploys as a static site.

One constraint encoded there: the DA layer's CORS allowlist does not include `x-api-key`, so
that header must not be sent from a browser. It isn't needed. `src/lib/fdc.live.test.ts`
asserts this keeps working.

## Contributing

Fork, branch, PR — see [`CONTRIBUTING.md`](../../CONTRIBUTING.md) in the repo root.
