# DoraHacks submission: Plime

Flare Summer Signal. Submissions close **14 Aug 2026, 19:59**. Structured against the
official Submission Requirements; every heading below is one of their bullets, in their
order. Copy-paste-ready.

---

## 1. Project name

**Plime**

## 2. Selected bounties

Both:

- **Bounty 1: Interoperable Asset Products**
- **Bounty 2: Confidential Compute Apps**

## 3. Short product description

Plime is an obligation and reputation primitive on Flare for products that depend on
whether an external payment happened before a deadline. It can power bonded deposits,
guarantees, tokenized-credit coupons, service commitments, and invoices. The working
reference product issues invoices payable in ordinary XRP and matched by destination tag.
Each obligation ends in exactly one permanent outcome: an FDC-proved payment receipt, or
an FDC-proved *non-payment* mark that can hand a posted FLR bond to the creditor in the same
transaction.

Most payment tooling can prove a payment happened. Almost nothing can prove one didn't,
because you cannot produce evidence of an absence. Flare's `XRPPaymentNonexistence` attestation, backed
by ~100 independent data providers, makes non-payment a network-attested fact. Plime is
the layer that makes that fact binding: it attaches the attestation to one specific
obligation, permits exactly one outcome ever, and settles value on it.

FDC supplies the fact; Plime supplies the consequence. The protocol binds either a
payment or non-payment proof to an acknowledged obligation, rejects proofs about the wrong
window or source chain, resolves an optional bond, and accumulates the permanent outcomes
into a reusable payment record. Invoices are the first interface for that mechanism, not
its limit.

## 4. Target user

Three concrete users, in order of how ready they are today:

1. **Anyone taking a deposit, retainer or milestone payment in XRP** (freelancers, agencies,
   OTC desks) who wants a missed payment to be a fact a third party can check, not a claim
   they have to argue. They post or require a bond; a mark pays it out automatically.
2. **A guarantor or counterparty who needs the failure to be machine-readable.** This is the
   real wedge. A contract on Flare cannot see the XRP Ledger, so it cannot know a payment
   never came. Plime is the piece that lets *any* Flare contract condition itself on an
   XRPL non-payment.
3. **Lenders underwriting XRPL counterparties.** They read the accumulated payment record
   through the confidential scorer, so they get the judgement without seeing the history.

Who it is *not* for: anyone whose counterparty risk is already covered by escrow or an
existing legal relationship. Plime matters where the parties don't trust each other and
no third party is willing to arbitrate.

## 5. Demo link, video, or working app link

| | |
| --- | --- |
| **Working app (live, seeded)** | https://quittance-azure.vercel.app |
| **No-wallet demo** | https://quittance-azure.vercel.app/?fixtures=1 |
| **Video** | _(fill in)_ |

The app is live on Coston2 with a seeded registry: judges can inspect real outcomes without
issuing anything. To interact, a Coston2 wallet with a little C2FLR from
https://faucet.flare.network/coston2.

**Suggested 60-second path for a judge:**

1. Open the app. **Invoice #2** is settled (FDC `XRPPayment`). **#3** is marked delinquent
   (FDC `XRPPaymentNonexistence`). **#4** is a bonded obligation whose 2 FLR bond was
   forfeited to the creditor on the mark. **#5** is a fabricated debt: marked, yet the named
   account's payment record stays clean.
2. Open **Attacks**: every entry is a real adversarial run against this same registry.
3. Open **Primitive**: the same three contract calls across four obligation kinds.
4. `?fixtures=1` renders every screen with no wallet at all, including states that are
   otherwise slow to reach (an invoice past its deadline with the proof still in flight).

## 6. GitHub repo / technical materials

- **Repo:** https://github.com/Eienel/Plime
- `contracts/`: `InvoiceRegistry`, `ScoreInstructionSender` (Solidity, 75 tests)
- `apps/web/`: the React app; runs the whole FDC lifecycle in the browser
- `fce/`: the Go TEE scorer for Confidential Space
- `services/attester/`: CLI for seeding and the adversary script
- `docs/FRONTEND_SPEC.md`, `docs/BUILD_PLAN.md`

## 7. How the project uses Flare

Flare is not a deployment target here; it is the only reason the product exists.

**Flare Data Connector: both directions of the same question.**
`XRPPayment` proves a specific XRPL transaction settled an invoice. `XRPPaymentNonexistence`
proves that **no** payment matching a destination address, amount and destination tag was
confirmed in a given ledger range. The registry consumes both through `FdcVerification`,
resolved at runtime from `FlareContractRegistry`.

**Why it cannot be ported.** Ask of any submission: could you move it to Ethereum unchanged?
An NFT marketplace, yes. A lending app, yes. Plime, no: there is no proof-of-absence
anywhere else at production scale. Move it and the product ceases to exist.

**Precedent inside Flare itself.** FAssets uses the sibling attestation
(`ReferencedPaymentNonexistence`) to prove redemption defaults and seize agent collateral.
Same mechanism, different obligation, which is the evidence that this is a primitive rather
than a one-off.

**Flare Compute Extensions.** Extension `66014`, registered on Coston2 against
`FlareTeeManager`. The scorer reads the on-chain payment record inside a TEE and returns a
score without exposing the history.

**No backend.** Both Flare services the app needs, the FDC verifier and the DA layer, send
`Access-Control-Allow-Origin: *`, so the browser runs the entire lifecycle itself:
`prepareRequest` → `FdcHub.requestAttestation` → wait out the voting round → fetch the Merkle
proof from the DA layer → `settle()` or `markDelinquent()`. Whoever has the page open can
drive an invoice to its outcome for a trivial amount of gas. The whole product is a static
site.

## 8. What was newly built during the program

Everything. Plime did not exist before Flare Summer Signal: nothing was ported in.

**Built from scratch:**

- `InvoiceRegistry`: invoice lifecycle, both proof paths, permanent per-account payment
  record. One outcome ever, enforced.
- **Bond escrow**: post, resolve, withdraw, and a 30-day grace reclaim. Proceeds are
  *pulled*, never pushed, so a hostile recipient can never block an outcome. 17 tests.
- **The acknowledgement mechanism**: closes a hole we found in our own design (below).
- **Proof-origin binding**: the registry pins its `sourceId` and attestation type. 8 tests.
- **Browser-side FDC pipeline**: the whole attestation lifecycle client-side, including a
  retry for the ~12 s XRPL finality race before the verifier will attest.
- **The adversary script**: three real attacks run against the live registry, generating the
  Attacks page.
- **Plime Confidential**: Go scorer for Confidential Space, extension `66014` registered.
- **The web app**: every screen, plus a full fixture mode so it demos with no wallet.

**Improved during the program, by attacking our own work.** Two genuine holes we found and
closed, both now regression-tested:

1. **Unilateral delinquency.** Anyone can write an invoice naming anyone as payer, and the
   nonexistence proof for it would be perfectly true. We added acknowledgement: a mark
   reaches an account's payment record only if that account first admitted the debt by
   sending any payment carrying the invoice's destination tag from their own XRPL account.
   The invoice can still be marked, because the proof is true, but an unacknowledged mark
   touches no record.
2. **Cross-chain proof substitution.** A nonexistence proof about XRP mainnet would satisfy
   every request-body field of a testnet invoice. The registry now pins `sourceId` at
   deployment. Stated honestly: on Coston2 today this is **hardening, not a live exploit**:
   its FDC attests only `(XRPPaymentNonexistence, testXRP)` and the verifier declines the
   request upstream.

## 9. Contract addresses and deployment details

| | |
| --- | --- |
| Network | **Flare Coston2 testnet**, chainId **114** |
| `InvoiceRegistry` | `0x6e88110e4d9dA843Fd3d87F6f5985201d7b28F99` |
| `ScoreInstructionSender` | `0xCf55db970F78adfD824B4B87f3b55c8901B47766` |
| Flare Compute Extension ID | `66014` |
| Explorer | https://coston2-explorer.flare.network |

Deployed on **Coston2**, not Songbird or Flare Mainnet. The registry is seeded and live: a
settled invoice, a delinquent one, a bonded obligation whose bond was forfeited on the mark,
and a fabricated debt marked against an account whose record stays clean.

**What is live vs. what is not**: stated plainly, because a judge should not have to find it:

| Component | State |
| --- | --- |
| `InvoiceRegistry`, both proof paths | Live on Coston2, exercised end-to-end |
| Bond escrow | Live, 17 tests |
| Proof-origin binding | Live, 8 tests |
| Browser-side FDC pipeline | Live, tested |
| XRPL payment detection | Live, client-side |
| Adversary run behind the Attacks page | Real, against the live registry |
| Confidential scorer | Model and enclave reader built and tested; sender and extension `66014` are live on Coston2. No TEE machine or result proxy is live, so the web app labels its score as a fixture preview. |

The confidential scorer is an implemented prototype, not a live confidential-compute
service. The remaining infrastructure is a registered TEE machine, public result proxy,
and end-to-end instruction delivery. The submission does not claim that fixture scores
were produced inside an enclave.

## 10. Short roadmap / next steps

**Immediately after the hackathon:**

- Bring the Confidential Space TEE fully live and register the measured code hash on-chain,
  so scores are produced in an enclave rather than from fixtures.
- Deploy to **Songbird**, then Flare Mainnet against XRPL mainnet. The registry pins its
  source chain at deployment, so this is a new deployment, not a migration.

**Next:**

- **Make the mark portable.** Today the payment record lives in one registry. The value
  compounds when any Flare contract can condition on it: lending protocols reading the
  record, escrow releasing on a mark, an FAssets-style agent posting a bond against delivery.
- **Third-party guarantors.** Bonds can already be posted by someone other than the payer.
  The next step is a market for that: underwriters pricing an account's record and selling
  the guarantee.
- **Beyond XRPL.** `ReferencedPaymentNonexistence` covers BTC, DOGE and others. The same
  registry generalizes to any chain the FDC attests, which turns four illustrative obligation
  kinds into live ones.
- Multi-vantage attestation for SLA-style obligations, where a heartbeat payment proves the
  heartbeat but not the service.

## 11. Distribution, testing and traction: the honest answer

**We have no users, no pilot, and no partner conversations.** Plime was built during the
program and has not been put in front of anyone outside the team. Claiming otherwise would be
easy and worthless.

What we *do* have, in place of traction:

- **A live, seeded, publicly reachable deployment** anyone can inspect without asking us for
  anything.
- **Adversarial testing against ourselves.** Three attacks constructed and run against the
  live registry, two of which found real holes that are now closed and regression-tested.
  This is the honest substitute for users: we could not test it with strangers, so we tested
  it as an attacker.
- **96 automated checks**: 75 Solidity contract tests and 21 web tests. The web suite includes
  11 `LIVE=1` checks against the Coston2 registry and live Flare services, alongside 10
  hermetic metadata tests.
- **A design constraint aimed squarely at distribution:** no backend. The whole product is a
  static site, and any holder of the page can drive an invoice to its outcome for gas. There
  is no server for us to keep running and no operator for a user to trust, which is what
  makes it plausible that this outlives the hackathon.

---

## Demo video outline (target 3 minutes)

- **0:00–0:20**: The problem in one sentence: you can prove you were paid; you cannot prove
  you weren't. Show a marked invoice.
- **0:20–1:00**: Issue an invoice. The destination tag dominates the pay screen; a payment
  without it cannot be matched, and the UI says so loudly.
- **1:00–1:45**: Miss a deadline with a bond posted. Show both futures *before* the deadline,
  then the FLR actually moving to the creditor on the mark. The whole pitch in one shot.
- **1:45–2:00**: The ~2 minute wait is real (XRPL finality ~12 s, an FDC voting round
  90–180 s) and is shown as a named pipeline, not a spinner. A named pipeline reads as rigor.
- **2:00–2:40**: The Attacks screen: three true proofs, three refusals.
- **2:40–3:00**: Primitive grid, then the confidential score with its status stated out loud.

## Pre-submission checklist

- [ ] Demo video recorded and linked in §5
- [ ] TEE status resolved in §9: live URL and code hash, or the plain caveat
- [ ] Custom domain live (avoids the wallet "malicious site" flag on `*.vercel.app`)
- [ ] `attacks.json` regenerated close to submission (`services/attester/bin/adversary.js`)
- [ ] Both bounty tracks selected on the BUIDL form
- [ ] Contract addresses here match what is deployed
- [ ] Repo public and `main` up to date
