# Plime

**An obligation primitive for products built on payment outcomes and reputation.**

Plime is a settlement and reputation protocol on Flare for obligations that depend on
whether an external payment happened before a deadline. Products can use it for bonded
deposits, guarantees, tokenized-credit coupons, service commitments, or invoices. The
working reference product issues invoices payable in XRP, matched by destination tag.
Every obligation ends in exactly one cryptographic outcome, never both and permanently:

- a **receipt** - an FDC-proved XRPL payment that discharges the obligation, or
- a **mark** - an FDC-proved *absence* of that payment by the deadline, which can hand a
  posted bond to the creditor in the same transaction.

Built for [Flare Summer Signal](https://dorahacks.io/hackathon/flaresummersignal/detail).
Live on Coston2, seeded, with a browser that drives the whole thing and no backend.

## The one thing this does that other systems can't

Most payment tooling can prove a payment *happened*. Almost nothing can prove one *didn't* -
because you cannot produce evidence of an absence. Contracts that fail by non-action (a
missed invoice, an unpaid coupon, a skipped SLA heartbeat) have always needed a trusted
party to declare the failure. One party's word.

Flare's Data Connector ships `XRPPaymentNonexistence`: an attestation, backed by ~100
independent data providers, that **no** XRPL payment matching a destination address, amount
and destination tag was confirmed in a given ledger range. That makes non-payment a
network-attested fact. Plime is the layer that makes that fact *binding*: attach it to
one specific obligation, permit exactly one outcome, and move money on it.

FDC supplies the fact; Plime supplies the consequence. It binds either a payment or
non-payment proof to an acknowledged obligation, rejects proofs about the wrong window or
chain, resolves an optional bond, and accumulates the permanent outcomes into a payment
record. Invoices are the first interface for that mechanism, not its limit.

Ask of any hackathon submission: *could you move it to Ethereum unchanged?* An NFT
marketplace, yes. A lending app, yes. Plime, no - there is no proof-of-absence anywhere
else at production scale. Move it and the product ceases to exist. That is the integration
depth this bounty rewards.

## Who is it for

- **Anyone who takes a deposit, retainer, or milestone payment in XRP** and wants a missed
  deadline to carry an automatic consequence rather than a chase-by-email. Post a bond at
  the start; the outcome moves it, needing no audience and no trust in a servicer.
- **Counterparties and lenders** who need to read whether an account pays on time - a
  network-attested payment record, not a self-reported one. Fraud in receivables (bogus
  debts, non-existent customers) is a real underwriting problem, and the record here is
  built so a fabricated debt cannot enter it.
- **Roadmap: tokenized-credit servicing**, where "was this coupon paid?" is worth real money
  and is today answered by a trusted servicer. Invoices are the demo; deadline-shaped
  obligations are the market.

Honest scope: this is a hackathon build on testnet, not a company. What it proves is the
mechanism, and that the mechanism survives being attacked (see **Attacks**, below).

## The two outcomes

| Outcome | Attestation type | What it establishes |
| --- | --- | --- |
| Receipt (paid) | `XRPPayment` | A specific XRPL transaction, this destination tag, at least this amount, reached the payee before the deadline. |
| Mark (unpaid) | `XRPPaymentNonexistence` | No such transaction exists anywhere in the invoice's ledger range. |

An invoice accepts exactly one, once, forever.

## How it uses Flare

- **FDC / `XRPPayment`** settles an invoice. `InvoiceRegistry.settle()` verifies the Merkle
  proof through `FdcVerification`, then checks the attested transaction against the invoice:
  destination tag, payee hash, amount, sender, XRPL success status, close time vs deadline.
- **FDC / `XRPPaymentNonexistence`** marks an invoice delinquent. `markDelinquent()` verifies
  the proof and then requires the *request body* to reproduce the invoice's own terms -
  search range, amount, payee, destination tag, no extra memo constraint.
- **FlareContractRegistry** resolves `FdcVerification` at runtime
  (`0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`, identical on every Flare network), so an FDC
  upgrade needs no redeploy.
- **Flare Compute Extension** (Part 2) scores the payment record inside a TEE - extension
  `66014`, registered on Coston2.

Nothing is bridged, wrapped, or custodied. The payer sends ordinary XRP; the destination tag
is the entire integration surface on the XRPL side.

## Attacks: why a true proof is not enough

The idea - proof of absence for invoicing - is not hard to arrive at. What sets this build
apart is that its security model was **attacked**, and shows its work. `Attacks`
(`apps/web/src/routes/Attacks.tsx`) renders a live run of
[`services/attester/bin/adversary.js`](services/attester/bin/adversary.js), which fires three
attacks at the deployed registry. Each uses an attestation that is **genuine and
FDC-confirmed** - and each is refused:

1. **Cherry-picked window.** A real proof that no payment arrived in a five-ledger slice
   chosen to exclude the payment that actually settled the invoice. The FDC confirms it; the
   registry rejects it, `ProofMismatch(minimalBlockNumber)`, because a nonexistence proof
   means nothing unless requested over the invoice's own range.
2. **Fabricated debt.** Anyone may write an invoice naming anyone as the payer. Let it lapse
   and the nonexistence proof is truthful - nobody paid. The invoice is marked, but the named
   account's payment record stays untouched, because a mark only accrues once the debtor has
   *admitted* the debt: any payment they sign carrying the invoice's destination tag. One
   drop is enough; paying in full admits it implicitly.
3. **Cross-chain substitution.** A mainnet nonexistence proof aimed at a testXRP invoice -
   trivially true there, every field matching. The registry pins its source chain at
   deployment and checks it. (Honestly labelled: not executable on Coston2 today, since its
   FDC attests only `(XRPPaymentNonexistence, testXRP)`; this is hardening the registry does
   not have to depend on, covered by `ProofOrigin.test.js`.)

## The bond: making the proof do something

A proof of non-payment, alone, only *says* something - the difference between a credit
bureau, whose reports gate credit, and a diary nobody reads. A registry with three invoices
is worth nothing to a lender, so a pure record only pays off at adoption scale a new protocol
does not have.

So an obligation can carry a **bond**: native FLR locked by the payer, or by a third party
guaranteeing them. Settlement returns it; a mark hands it to the issuer, released by the very
same attestation that records the mark. The first invoice ever issued is therefore useful to
its two parties, with no audience - and the payment record accrues quietly in the background
instead of being the thing that must be bootstrapped first.

Proceeds are **pulled, not pushed** (`withdraw()` credits, never transfers inline): otherwise
a creditor whose address rejects payment could make their own invoice unsettleable, and a
debtor could block their own mark. An unresolved bond can be reclaimed by its poster 30 days
past the deadline, so an outcome nobody proves cannot strand the money forever.

## There is no backend

Both Flare services the app needs - the FDC verifier and the DA layer - send
`Access-Control-Allow-Origin: *`, so `apps/web/src/lib/fdc.ts` runs the whole attestation
lifecycle in the browser: prepare → `FdcHub.requestAttestation` (a tiny fee) → wait for the
voting round → fetch the Merkle proof → `settle()` / `markDelinquent()`. Whoever has the page
open drives an invoice to its outcome for a trivial amount of gas. The whole product is a
static site.

## Repository layout

```
contracts/
  src/InvoiceRegistry.sol            # issuance, settle, acknowledge, markDelinquent,
                                     #   one-outcome guard, bond escrow, source-chain binding, records
  src/fce/ScoreInstructionSender.sol # on-chain entry point for the confidential scorer
  src/test/MockFdcVerification.sol   # accept/reject stand-in for FdcVerification
  src/test/RejectingRecipient.sol    # hostile bond recipient, proves outcomes can't be blocked
  test/                              # 75 tests: registry, acknowledgement, bond, proof-origin
  script/deploy.js  script/deploy-fce.js
services/attester/
  src/fdc.js  src/xrpl.js  src/registry.js   # FDC lifecycle, XRPL helpers, outcome pipelines
  bin/plime.js                   # CLI: fund|create|pay|acknowledge|settle|mark|status|record|watch
  bin/seed-demo.js                   # seeds the four demo states on a fresh registry
  bin/adversary.js                   # runs the three attacks, writes apps/web/src/lib/attacks.json
apps/web/                            # React + Vite + TypeScript app (this is the frontend)
apps/reference/index.html            # original single-file vanilla page, superseded, kept for reference
fce/scorer/                          # Go TEE scorer for Confidential Space
```

## Run it

```bash
# contracts
cd contracts && npm install && npx hardhat compile && npx hardhat test    # 75 tests

# web (fixture mode needs no wallet or network)
cd apps/web && npm install && npm run dev        # http://localhost:5173/?fixtures=1
```

Deploy to Coston2 (needs `PRIVATE_KEY` funded with C2FLR from the faucet). `XRPL_SOURCE`
pins the chain the registry accepts proofs from:

```bash
PRIVATE_KEY=0x... XRPL_SOURCE=testXRP npx hardhat run script/deploy.js --network coston2
```

## Deployed (Coston2)

| Contract | Address |
| --- | --- |
| `InvoiceRegistry` | [`0x6e88110e4d9dA843Fd3d87F6f5985201d7b28F99`](https://coston2-explorer.flare.network/address/0x6e88110e4d9dA843Fd3d87F6f5985201d7b28F99) |
| `ScoreInstructionSender` (FCE `66014`) | [`0xCf55db970F78adfD824B4B87f3b55c8901B47766`](https://coston2-explorer.flare.network/address/0xCf55db970F78adfD824B4B87f3b55c8901B47766) |

The registry is **seeded and live** with all four demo states: a settled invoice, an
acknowledged delinquency, a bonded obligation whose 2 FLR bond was forfeited to the issuer on
the mark, and a fabricated debt marked against an account whose record stays clean. The
`Attacks` screen is driven by a real run of the adversary against this same registry.

## Status

| Component | State |
| --- | --- |
| `InvoiceRegistry` - both proof paths, one-outcome guard, records | Live on Coston2 |
| Acknowledgement - consent before a mark reaches a record | Live |
| Bond escrow - post, resolve, withdraw, grace reclaim | Live |
| Proof-origin binding - source chain + attestation type | Live |
| Solidity contract suite | **75 tests**; verified on every pull request |
| Web suite | **21 passing with `LIVE=1`**: 10 hermetic and 11 Coston2/FDC checks |
| Browser-driven FDC pipeline (no backend) | Live, tested |
| Adversarial demo - three genuine proofs, all refused | Live, on-chain |
| Web app - data layer + hooks | Done, tested against live chain |
| Web app - visual layer | Scaffold; the frontend build is in progress |
| Confidential scorer (FCE) - model, in-enclave reader, registration | Done, extension `66014` |
| FCE reproducible image + TEE machine registration | Image built & reproducible; machine needs a Confidential Space VM |

## Part 2: Plime Confidential

The payment record is public - that is what makes it checkable - but a payment history is
commercially sensitive, and a lender needs the judgement, not the ledger. So a Flare Compute
Extension scores an account **inside a TEE**: an account hash goes in, the enclave reads the
full history from `InvoiceRegistry` itself, and only `{score, band, basis}` comes out. Counts,
amounts, dates and counterparties never cross the boundary, and the machine's attested
identity is what makes that checkable rather than promised.

Registration is **permissionless on Coston2** - the same network as the registry - so
extension `66014` is registered and owned by us, no Foundation involvement. The scoring model,
the in-enclave reader, and live verification against real Coston2 data are in
[`fce/README.md`](fce/README.md). The one remaining step is registering a TEE machine, which
needs a Google Cloud Confidential Space VM.

## Roadmap

- Mainnet deployment.
- BTC and DOGE obligations via `ReferencedPaymentNonexistence` - the same primitive, other chains.
- Recurring obligations (dead-man switch: silence itself produces the mark) - subscriptions, SLAs.
- A delinquency/score read API for lenders and counterparties.
- Tokenized-credit servicing: default detection for coupons and redemptions.
- Full private scoring once FCC reaches mainnet.

## Notes

FDC voting rounds take ~90 s and XRPL finality ~12 s, so both outcome paths are asynchronous
by construction. The verifier returns `TRANSACTION DOES NOT EXIST` until a payment reaches
finality - a race to wait out, not a rejection, handled in both the attester and the browser.
The UI is built around the ~2-minute wait rather than hiding it.
