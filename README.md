# Quittance

**Every invoice ends in a quittance or a mark.**

Quittance is an invoicing protocol on Flare where any XRPL payment — from any wallet or
exchange, matched by destination tag — produces a cryptographic outcome either way: an
FDC-proved receipt if the invoice is paid, or a permanent Merkle-proved delinquency mark if
the deadline passes. A planned confidential-compute extension turns that payment history
into a private credit score inside a TEE.

> *Quittance* is the historical term for a document discharging a debt — proof that the
> obligation is settled.

Built for [Flare Summer Signal](https://dorahacks.io/hackathon/flaresummersignal/detail).

## Why this is not just an invoice app

Most payment tooling can prove a payment happened. Almost nothing can prove one *didn't*.
Flare's Data Connector ships `XRPPaymentNonexistence`, an attestation that no XRPL payment
matching a destination address, amount, and destination tag was confirmed in a given ledger
range. That makes non-payment a first-class, network-attested fact rather than one party's
claim — which is what a payment record needs to be worth anything to a third party.

The two outcomes are symmetric and mutually exclusive:

| Outcome | Attestation type | What it establishes |
| --- | --- | --- |
| Quittance (paid) | `XRPPayment` | A specific XRPL transaction, with this destination tag and at least this amount, reached the payee before the deadline. |
| Mark (unpaid) | `XRPPaymentNonexistence` | No such transaction exists anywhere in the invoice's ledger range. |

An invoice accepts exactly one of them, once, permanently.

## How it uses Flare

- **FDC / `XRPPayment`** — settles an invoice. `InvoiceRegistry.settle()` verifies the
  Merkle proof through `FdcVerification`, then checks the attested transaction against the
  invoice itself: destination tag, payee address hash, amount, sender, XRPL success status,
  and close time versus deadline.
- **FDC / `XRPPaymentNonexistence`** — marks an invoice delinquent.
  `InvoiceRegistry.markDelinquent()` verifies the proof and then requires the *request body*
  to reproduce the invoice's terms exactly — search range, amount, payee, destination tag,
  and no extra memo constraint. This is the load-bearing check: a nonexistence proof only
  means something relative to the window it was requested over, so without it a creditor
  could prove "no payment" over a hand-picked one-ledger window and mark a payer who
  settled in full. See `markDelinquent` in
  [`contracts/src/InvoiceRegistry.sol`](contracts/src/InvoiceRegistry.sol).
- **FlareContractRegistry** — `FdcVerification` is resolved at runtime through the canonical
  registry (`0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`, identical on every Flare network),
  never hardcoded, so an FDC upgrade requires no redeploy.

Nothing is bridged, wrapped, or custodied. The payer sends ordinary XRP from whatever they
already use; the destination tag is the entire integration surface on the XRPL side.

## Repository layout

```
contracts/
  src/InvoiceRegistry.sol          # create / settle / markDelinquent, one-outcome guard, payer records
  src/test/MockFdcVerification.sol # accept/reject stand-in for FdcVerification in unit tests
  test/InvoiceRegistry.test.js     # 34 tests, incl. the cherry-picked-window attack matrix
  script/deploy.js
services/attester/
  src/fdc.js                       # FDC lifecycle: verifier → FdcHub (fee) → round wait → DA proof
  src/xrpl.js                      # faucet funding, tagged payments, ledger clock
  src/registry.js                  # settle / markDelinquent pipelines against the registry
  bin/quittance.js                 # CLI: fund | create | pay | settle | mark | status | record | watch
apps/web/
  index.html                       # static UI: issue invoices, pay instructions, outcomes, records
```

### Attester quickstart

```bash
cd services/attester && npm install && cp .env.example .env  # fill PRIVATE_KEY + INVOICE_REGISTRY
node bin/quittance.js fund                                   # fresh funded XRPL testnet account
node bin/quittance.js create --payee rPAYEE --payer rPAYER --xrp 10 --minutes 10
node bin/quittance.js pay --seed sSEED --to rPAYEE --tag 1 --xrp 10
node bin/quittance.js watch --payee rPAYEE                   # drives every open invoice to its outcome
```

## Data model

An invoice fixes, at issuance, every parameter that either proof will later be checked
against:

| Field | Meaning |
| --- | --- |
| `destinationTag` | Unique `uint32` issued by the registry; the XRPL-side primary key. |
| `payeeAddressHash` | Standard address hash of the XRPL account to be paid. |
| `payerAddressHash` | The debtor the outcome is attributed to. Zero makes it a bearer invoice: anyone may settle it, and a lapse marks nobody. |
| `acknowledged` | Whether that debtor has admitted the debt. Nothing reaches their record until they do — see below. |
| `amountDrops` | Amount owed in drops (1 XRP = 1,000,000 drops). Overpayment settles; underpayment does not. |
| `minimalBlockNumber` / `deadlineBlockNumber` / `deadlineTimestamp` | The ledger range within which payment counts — and the exact range a nonexistence proof must be requested over. |

Outcomes accumulate into a `PayerRecord` per XRPL account (settled/delinquent counts and
drop totals, plus the last outcome time). That record is the input the confidential scorer
is designed to read.

### Consent: why a truthful proof is not enough

Issuance is unilateral — anyone may write an invoice naming anyone as the payer. A
nonexistence proof over such an invoice is perfectly true and completely meaningless: it
proves nobody paid a debt that was never owed. Left unguarded, that turns the registry into
a way to manufacture delinquencies against any XRPL account, and a lender reading a record
could not tell a real obligation from a fabricated one.

So the payer's own signature over the debt is what admits it into their record, and the
XRPL itself carries that signature: **any payment from the payer's account to the payee
bearing the invoice's unique destination tag** is an act only the key-holder could perform,
against terms only that invoice defines. One drop is enough. Paying in full acknowledges
implicitly, so an honest payer never does this separately.

An unacknowledged invoice can still be marked — the mark is true — but it touches no
payment record. The invoice carries the outcome; the record stays trustworthy, because
third parties lend against it.

## Running it

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
```

Deploy to Coston2 (needs `PRIVATE_KEY` funded with C2FLR from the faucet):

```bash
PRIVATE_KEY=0x... npx hardhat run script/deploy.js --network coston2
```

## Status

| Component | State |
| --- | --- |
| `InvoiceRegistry` — issuance, both proof paths, one-outcome guard, payer records | Implemented, 34 passing tests |
| FDC request/proof lifecycle (verifier → FdcHub → round wait → DA layer) | Implemented (`services/attester/src/fdc.js`); prepareRequest verified live for both attestation types on testXRP |
| Attester service — CLI + deadline watcher driving both outcome paths | Implemented (`services/attester`); live XRPL payment with destination tag verified on testnet |
| Web UI — invoice creation, pay instructions, status, registry | Implemented (`apps/web`, static, wallet-connected) |
| Coston2 deployment + full E2E, both outcomes | **Done** — see below |
| Confidential scorer (FCE) — model, in-enclave registry reader, handler, on-chain registration | **Done** — extension `65975` live on Coston2 ([`fce/`](fce/)) |
| FCE reproducible image + TEE machine registration | Needs Docker + a Confidential Space VM |

## Deployed (Coston2)

| Contract | Address |
| --- | --- |
| `InvoiceRegistry` | [`0x14E50b59fA00c252155E5c532580d9581933D7b9`](https://coston2-explorer.flare.network/address/0x14E50b59fA00c252155E5c532580d9581933D7b9) |
| `ScoreInstructionSender` (FCE `65975`) | [`0x2793D55DBe8aED3bD1396B8a29bb42A7D1902b44`](https://coston2-explorer.flare.network/address/0x2793D55DBe8aED3bD1396B8a29bb42A7D1902b44) |

Both outcomes were exercised end-to-end against the XRPL testnet on the predecessor
deployment (`0xC07009…2d00A`, before acknowledgement was added):

- **Quittance** — an invoice paid on the XRPL
  (tx `9E6C3DDEF5E35CE1C8E91A2705B20B9DEC6875C88B77403C1587DC56BB4DDC96`) and settled with a
  live FDC `XRPPayment` proof in Coston2 tx
  [`0x5b7d97b740cd8d98ffed222e4e4987040a931164b2b66c9211f80ee5fb9affff`](https://coston2-explorer.flare.network/tx/0x5b7d97b740cd8d98ffed222e4e4987040a931164b2b66c9211f80ee5fb9affff).
- **Mark** — an invoice left unpaid past its deadline and marked delinquent with a live FDC
  `XRPPaymentNonexistence` proof in Coston2 tx
  [`0x1798e8ee21a08b1c13c27ec4cf19d4cf5d4e44ea0d35a288676d4ff7813737b5`](https://coston2-explorer.flare.network/tx/0x1798e8ee21a08b1c13c27ec4cf19d4cf5d4e44ea0d35a288676d4ff7813737b5).

> **The current deployment is not yet seeded.** Re-seeding needs a working XRPL testnet
> node, and both public endpoints were unreachable at the time of deployment
> (`testnet.xrpl-labs.com` out of sync; `s.altnet.rippletest.net` unreachable from the build
> sandbox). Run `services/attester/bin/seed-demo.js` from any normal network — about ten
> minutes — and it produces all three demo states, including the fabricated debt that proves
> an unacknowledged mark reaches nobody's record.

## Part 2: Quittance Confidential

That record is public, which is what makes it checkable — but a payment history is
commercially sensitive, and a lender needs the judgement, not the ledger. So the second
half of the project is a Flare Compute Extension that scores an account **inside a TEE**:
an account hash goes in, the enclave reads the full history from `InvoiceRegistry` itself,
and only `{score, band, basis}` comes out. Counts, amounts, dates and counterparties never
cross the boundary, and the machine's attested identity is what makes that checkable
rather than merely promised.

Registration turned out to be **permissionless on Coston2** — the same network as the
registry, not Songbird as expected — so extension `65975` is registered and owned by us,
with no Foundation involvement. Details, scoring model, and the live verification against
real Coston2 data are in [`fce/README.md`](fce/README.md).

Unit tests mock `FdcVerification`, because a real Merkle proof against a relayed root cannot
be produced in-process. Everything downstream of proof validity — every term check, the
one-outcome guard, the record accounting — is exercised for real. Proof verification itself
is covered by the Coston2 integration path, not by these tests.

Contract addresses will be listed here once deployed.

## Roadmap

- Mainnet deployment.
- BTC and DOGE invoices via `ReferencedPaymentNonexistence`.
- Recurring invoices (dead-man switch: silence itself produces the mark).
- A delinquency/score read API for lenders and counterparties.
- Private scoring inside a Flare Compute Extension: the scorer reads the registry inside a
  Google Cloud Confidential Space enclave, and only the score plus its attestation leave —
  raw payment history never does. Full deployment follows FCC reaching mainnet.

## Notes

FDC voting rounds take roughly 90 seconds and XRPL finality about 12 seconds, so both
outcome paths are asynchronous by construction; the UI is designed around that wait rather
than trying to hide it.
