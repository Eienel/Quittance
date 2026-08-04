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
| `amountDrops` | Amount owed in drops (1 XRP = 1,000,000 drops). Overpayment settles; underpayment does not. |
| `minimalBlockNumber` / `deadlineBlockNumber` / `deadlineTimestamp` | The ledger range within which payment counts — and the exact range a nonexistence proof must be requested over. |

Outcomes accumulate into a `PayerRecord` per XRPL account (settled/delinquent counts and
drop totals, plus the last outcome time). That record is the input the confidential scorer
is designed to read.

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
| Coston2 deployment + full E2E | Blocked on faucet C2FLR (captcha-gated) |
| Confidential scorer (FCE on Confidential Space) | Gated on the above being end-to-end |

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
