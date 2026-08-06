# Quittance — project brief

Read this before touching anything. It is written for an agent joining the frontend work.

---

## What this is

An invoicing protocol on Flare. Someone issues an invoice payable in XRP; the payer sends
ordinary XRP from any wallet or exchange, tagging it with a **destination tag**. The invoice
then ends in exactly one of two outcomes, **never both, and permanently**:

| Outcome | Meaning | Proof |
| --- | --- | --- |
| **Quittance** | Paid, on time | Flare Data Connector `XRPPayment` attestation |
| **Mark** | No such payment exists in the window | FDC `XRPPaymentNonexistence` attestation |

The second one is the whole point. Plenty of systems can prove a payment *happened*. Almost
nothing can prove one *didn't*. Flare's `XRPPaymentNonexistence` attestation makes
non-payment a network-attested fact rather than one party's claim — which is what makes a
payment record worth anything to a third party who trusts neither side.

Outcomes accumulate into a permanent per-account payment record. A second component
(**Quittance Confidential**) scores that record inside a TEE, so a lender gets the judgement
without ever seeing the history.

Tagline: *Every invoice ends in a quittance or a mark.*

Built for the Flare Summer Signal hackathon (DoraHacks), submission **14 Aug 2026**, entered
for two bounties: Interoperable Asset Products, and Confidential Compute Apps.

---

## Live right now

| Thing | Where |
| --- | --- |
| Deployed app | https://quittance-azure.vercel.app |
| `InvoiceRegistry` (Coston2) | `0xC07009A556b88674BeA88BBd5794A7ef8402d00A` |
| `ScoreInstructionSender` (Coston2) | `0xfebD5Fa7e8f42d5fF05Aa2d6CEf00e98cafD8256` |
| Flare Compute Extension ID | `65940` |
| Chain | Flare Coston2 testnet, chainId **114** |
| Explorer | https://coston2-explorer.flare.network |

The registry already holds two real invoices from an end-to-end run — invoice 1 settled
(5 XRP), invoice 2 delinquent (7 XRP) — so there is meaningful data to render immediately.

---

## Architecture, and the one surprising thing

```
apps/web/          ← the React app. THIS IS WHERE FRONTEND WORK HAPPENS
apps/reference/    ← superseded single-file vanilla page, kept for reference
contracts/         ← Solidity: InvoiceRegistry, ScoreInstructionSender
services/attester/ ← Node CLI for seeding demo data (not needed by the app)
fce/               ← Go TEE scorer for Confidential Space
docs/              ← FRONTEND_SPEC.md, BUILD_PLAN.md
```

**There is no backend.** Both Flare services the app needs (the FDC verifier and the DA
layer) send `Access-Control-Allow-Origin: *`, so `apps/web/src/lib/fdc.ts` runs the entire
attestation lifecycle in the browser:

```
prepareRequest → FdcHub.requestAttestation (pays a tiny fee)
→ wait for the voting round to finalize → fetch the Merkle proof from the DA layer
→ InvoiceRegistry.settle() or .markDelinquent()
```

So nobody has to run a server for an invoice to settle. Whoever has the page open can drive
it through for a trivial amount of gas. The whole product is a static site. Don't add a
backend or serverless functions — nothing needs one.

One constraint that is easy to break: the DA layer's CORS allowlist does **not** include
`x-api-key`, so that header must never be sent from the browser. It isn't required.
`src/lib/fdc.live.test.ts` pins this.

---

## Scope: what is yours and what is not

**Yours — change freely:**
- `apps/web/src/components/` — all of it
- `apps/web/src/routes/` — layout and presentation
- `apps/web/src/styles.css` — placeholder, expected to be replaced wholesale
- Adding a QR library (pre-approved; the pay screen needs one)

**Not yours — coordinate before changing:**
- `apps/web/src/lib/` and `apps/web/src/hooks/` — the data layer. Tested against the live
  chain and live Flare services (18 tests). If you need it to expose something it doesn't,
  ask rather than reworking the fetching.
- `contracts/`, `services/`, `fce/` — backend.

Anything wrapped in a `.stub` CSS class is a placeholder that labels itself on screen. Those
are exactly the things to replace.

---

## How to work

```bash
cd apps/web
npm install
npm run dev                          # http://localhost:5173

npm run typecheck                    # strict tsc — must stay clean
npm test                             # hermetic unit tests
LIVE=1 npm test                      # + reads the real Coston2 chain and Flare services
npm run build
```

**Start in fixture mode:** `http://localhost:5173/?fixtures=1`

Every screen renders from `src/lib/fixtures.ts` — no wallet, no network, no waiting. It
covers states that are otherwise slow or impossible to reach by hand: an invoice that has
lapsed but whose proof is still in flight (a ~2 minute window), a bearer invoice, an empty
record versus a clean one, a thin-file score, and a huge amount for layout testing.

Drop the query param to read live Coston2 data.

To interact (issue an invoice, record an outcome) you need a wallet on Coston2 with a little
C2FLR: https://faucet.flare.network/coston2

---

## Five things that will bite you

**1. The destination tag is the entire payer-side surface.**
A payment sent without it cannot be matched. The invoice still goes delinquent, and the
payer's money has reached the payee with no record of what it settled. This is the single
most likely way a live demo fails. The tag must be the largest, most copyable element on the
pay screen, with an explicit warning.

**2. ~2 minutes of latency is real and cannot be engineered away.**
XRPL finality is ~12 s; an FDC voting round is 90–180 s. The XRPL side is visible to us
within seconds, so `usePipeline` shows genuine progress across the gap. A named pipeline
reads as rigor; a two-minute spinner reads as broken. Do not hide this — make it the story.

**3. There is a fourth status the contract doesn't have.**
On-chain an invoice is Open / Settled / Delinquent. But an Open invoice past its deadline is
already decided — the proof is just in flight. The UI calls that **`lapsed`** and it must
stay visually distinct. Rendering it as "open" makes a working system look stuck. Keep
`.status-open`, `.status-lapsed`, `.status-settled`, `.status-delinquent` distinguishable.

**4. Address hashes are one-way.**
The chain stores `keccak256(xrplAddress)`, never the address. Two mechanisms cover this: the
issuer publishes the payee address in the invoice's on-chain metadata (`metadata.ts`, which
re-hashes and verifies it before trusting it), and `addressBook.ts` remembers addresses the
user types. Show the friendly address when known, a truncated hash otherwise — never fake it.

**5. `score: 0` means "no record", not a score of zero.**
And always display `basis` (how many attested outcomes back the score). A 700 from two
invoices is a different claim from a 700 from forty. Hiding that would be the dishonest
version of that screen, and a judge will poke at exactly it.

---

## Status

| Component | State |
| --- | --- |
| `InvoiceRegistry`, both proof paths | Live on Coston2, exercised end-to-end |
| Browser-side FDC pipeline | Live, tested |
| XRPL payment detection | Live, client-side |
| Web app data layer | Done, 18 tests |
| Web app visual layer | **Scaffold only — this is the work** |
| Confidential scorer | Model + enclave reader built and tested; extension registered; **no TEE machine yet**, so no live score. Build against `fixtures.scores` |

---

## Contributing

Fork → branch → PR to `Eienel/Quittance`, base `main`. Deploy your own fork to your own
Vercel project for previews: import the fork, accept every default (`vercel.json` at the repo
root sets build command, output dir and SPA rewrites), no environment variables. **Do not
override the build settings in the Vercel dashboard** — auto-detection guesses wrong because
the app lives in `apps/web`, not the root. A 404 on any route except `/` means the dashboard
is overriding `vercel.json`, not a bug in your code.

Full detail: [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`apps/web/README.md`](apps/web/README.md)
· [`docs/FRONTEND_SPEC.md`](docs/FRONTEND_SPEC.md)

Conventions: TypeScript strict, no `any` without a reason; `bigint` for on-chain integers
all the way to display; comments explain *why*, not *what*; no new dependencies without
saying so in the PR; never commit a key or `.env`.
