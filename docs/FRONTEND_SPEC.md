# Quittance — Frontend Handoff Spec

Everything the UI needs, and how to test each piece without waiting on the backend.

**You do not need to run any backend service.** All state lives on Coston2 and the XRPL
testnet, both of which are public. The UI reads them directly over HTTPS/RPC. The one thing
the UI cannot do alone is *produce* an FDC proof — that's the attester's job (§7).

**There is now a scaffolded React/Vite/TypeScript app at `apps/web`** with the whole data
layer built and tested against the live chain — read [`apps/web/README.md`](../apps/web/README.md)
first, then come back here for product detail. Run it with `?fixtures=1` to see every state
without a wallet or a network.

The original single-file vanilla page is kept at `apps/reference/index.html` — superseded,
but it proves the wiring in one file with no build step.

---

## 1. What this product is (so the UI can argue for it)

An invoice on Quittance ends in exactly one of two outcomes, and **never both**:

| Outcome | What it means | How it's proved |
| --- | --- | --- |
| **Quittance** (settled) | The XRPL payment happened, on time | FDC `XRPPayment` attestation |
| **Mark** (delinquent) | No such payment exists, anywhere in the window | FDC `XRPPaymentNonexistence` attestation |

The second one is the unusual part and should be visually prominent. Most systems can prove
a payment happened. Almost nothing can prove one *didn't*. That "proof of absence" is what
turns a missed invoice into a permanent, third-party-checkable fact rather than one party's
word. **The UI's job is to make that asymmetry legible.**

Payers use any XRPL wallet or exchange. There is nothing to install, no bridging, no
custody. The entire integration surface on the payer's side is a **destination tag** — a
number they type into a normal XRP send.

Tagline: *Every invoice ends in a quittance or a mark.*

---

## 2. Live addresses and endpoints

```js
// Flare Coston2 testnet
const CHAIN_ID   = 114;                 // 0x72
const RPC        = "https://coston2-api.flare.network/ext/C/rpc";
const EXPLORER   = "https://coston2-explorer.flare.network";

const INVOICE_REGISTRY        = "0x1267431d069c0F3587dbAA05c41d76e677bFaA4c";
const SCORE_INSTRUCTION_SENDER = "0x3Fa4d7E94a5c28Ab40f2605Fbfc5A8bFd3709347";
const FCE_EXTENSION_ID        = 66012;

// XRPL testnet — plain JSON-RPC over POST, CORS-friendly, no key needed
const XRPL_RPC    = "https://testnet.xrpl-labs.com";
const XRPL_FAUCET = "https://faucet.altnet.rippletest.net/accounts";
const XRPL_EXPLORER = "https://testnet.xrpl.org";
```

ABIs are committed as JSON at `apps/web/abi/InvoiceRegistry.json` and
`apps/web/abi/ScoreInstructionSender.json`. Import those rather than hand-writing
signatures.

Wallet needs **C2FLR** for gas: https://faucet.flare.network/coston2

> ⚠️ Nothing above is a secret, but the deployer key in `services/attester/.env` is
> gitignored and must stay that way. The UI never needs a private key — users sign with
> their own wallet.

---

## 3. Data model

### Invoice

`getInvoice(uint256 id)` and `getInvoiceByTag(uint32 tag)` both return:

| Field | Type | Notes for display |
| --- | --- | --- |
| `issuer` | `address` | Flare address that created it |
| `destinationTag` | `uint32` | **The hero number.** What the payer types into their wallet |
| `status` | `uint8` | `0` None · `1` Open · `2` Settled · `3` Delinquent |
| `payeeAddressHash` | `bytes32` | keccak256 of the payee's XRPL address — *not reversible*, see §3.1 |
| `amountDrops` | `uint256` | Divide by 1e6 for XRP |
| `minimalBlockNumber` | `uint64` | Start of the XRPL ledger window |
| `deadlineBlockNumber` | `uint64` | Last ledger that counts as on time |
| `deadlineTimestamp` | `uint64` | Unix seconds. **Use this for countdowns** |
| `payerAddressHash` | `bytes32` | The debtor. `0x00…0` = bearer invoice, anyone may pay |
| `settledByAddressHash` | `bytes32` | Who actually paid (Settled only) |
| `outcomeTimestamp` | `uint64` | XRPL time of the payment, or of the overflow block |
| `metadataURI` | `string` | Free-form; may be empty |

`invoiceCount()` returns the highest id. **IDs start at 1**, not 0. There is no
"get all invoices" call — loop `id` from `invoiceCount()` downward, or read
`InvoiceCreated` events (cheaper for long lists — see §8).

### 3.1 Address hashes — important UX constraint

The chain stores `keccak256(utf8(xrplClassicAddress))`, **not** the address. You cannot
turn a hash back into an `r...` address. So:

- When the UI has the address (user just typed it), hash it and match locally.
- When rendering an invoice fetched cold from chain, you can only show a truncated hash
  unless you kept the address client-side.
- **Recommendation:** keep an address book in `localStorage` mapping hash → address, and
  populate it whenever the user types an address. Show the friendly address when known,
  the truncated hash otherwise. Don't pretend you can resolve it.

```js
const addrHash = (r) => ethers.keccak256(ethers.toUtf8Bytes(r.trim()));
```

### PayerRecord

`record(bytes32 payerAddressHash)` returns the permanent history of one XRPL account:

| Field | Type |
| --- | --- |
| `settledCount` | `uint64` |
| `delinquentCount` | `uint64` |
| `settledDrops` | `uint256` |
| `delinquentDrops` | `uint256` |
| `lastOutcomeTimestamp` | `uint64` |

All zeros = no attested history. Display that as "no record", **not** "clean record" —
they're different claims and the distinction matters to a lender.

---

## 4. Screens

### 4.1 Create invoice

Inputs: payee XRPL address, payer XRPL address (optional), amount in XRP, deadline.

The deadline needs **both** a ledger index and a timestamp. Derive them from the current
XRPL ledger (~4 s per ledger):

```js
async function xrplLedgerNow() {
  const res = await fetch(XRPL_RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "ledger", params: [{ ledger_index: "validated" }] })
  });
  const { result } = await res.json();
  return {
    ledgerIndex: Number(result.ledger_index ?? result.ledger.ledger_index),
    closeTimeUnix: Number(result.ledger.close_time) + 946684800  // Ripple epoch → Unix
  };
}

// then
const deadlineTs     = closeTimeUnix + minutes * 60;
const deadlineLedger = ledgerIndex + Math.ceil(minutes * 60 / 4);
```

Call:
```js
createInvoice(payeeHash, payerHash, amountDrops, ledgerIndex, deadlineLedger, deadlineTs, metadataURI)
```
Read the assigned tag from the `InvoiceCreated` event in the receipt — **the return value
is not accessible from a transaction**, only from the event.

**Empty payer = bearer invoice.** Make this a deliberate toggle with an explanation, not a
blank field. It changes the semantics: anyone may settle it, and if it lapses, nobody's
record is marked. That's a real product decision the issuer is making.

### 4.2 Pay instructions — the most important screen

This is what a judge will actually use. It must be copy-paste-proof and work on a phone
next to a desktop.

Show, unmistakably:
1. **Destination address** (`r...`) — copy button
2. **Destination tag** — copy button, biggest element on screen
3. **Exact amount** in XRP
4. **Live countdown** to the deadline

Plus a **QR code** encoding the XRPL payment URI:
```
ripple:rPAYEE?amount=10&dt=42
```
(amount in XRP, `dt` = destination tag). Most XRPL wallets parse this.

> **The single most common failure mode is a payment sent without the destination tag.**
> It cannot be matched to the invoice and the invoice will still go delinquent. Warn about
> this explicitly and repeatedly. This is worth a dedicated callout, not fine print.

### 4.3 Invoice list

Status badge per invoice: `open` (blue) / `settled ✓` (green) / `delinquent ✗` (red).

For open invoices show the countdown. **When the deadline passes, an open invoice does not
instantly become delinquent** — it enters a pending window while the FDC round runs
(~90–180 s). Show that as a distinct third state, e.g. "lapsed — proving…". Silence there
reads as a bug.

### 4.4 Payment record / lender view

Input an XRPL address → show `settledCount` / `delinquentCount` and the drop totals.

This is the "why does this exist" screen. Frame it as what a counterparty sees before
extending credit. A delinquency here is permanent and network-attested — no one can
retract it, including the issuer.

### 4.5 Confidential score (Part 2) — the differentiator

Same input (an XRPL address), but the number comes from a TEE, not from the chain.

**The story the UI must tell:** the enclave reads the account's *entire* payment history —
every invoice, every amount, every date — and returns only a score. The history never
leaves. Show this as a visible boundary: raw history on one side marked "never exposed",
the score crossing over.

Response shape:
```json
{ "score": 516, "band": "poor", "basis": 2, "version": "quittance-score-1" }
```
- `score` — 300–850, or **0 meaning no history** (render as "no record", not a zero score)
- `band` — `none` | `poor` | `fair` | `good` | `excellent`
- `basis` — how many attested outcomes back the score. **Show this.** A 700 on 2 outcomes
  is a different claim from a 700 on 40, and hiding it would be the dishonest version of
  this screen.
- `version` — the model version, so a score is reproducible

Trigger: `ScoreInstructionSender.requestScore(bytes32 payerAddressHash)`, payable. The
result arrives asynchronously from the TEE, so this screen needs the same
pending → resolved treatment as the proof flows.

**Do not build this screen against a live TEE yet.** Machine registration is the last
remaining backend step (§9). Build it against the fixture in §6.3 and it will drop in.

---

## 5. Async is the defining UX constraint

Nothing here is instant, and pretending otherwise will make it feel broken:

| Step | Typical wait |
| --- | --- |
| XRPL payment validates | ~4 s |
| XRPL finality (3 confirmations) | ~12 s |
| FDC voting round finalizes | **90–180 s** |
| DA layer serves the proof | +0–30 s |

So from "payer hits send" to "receipt on screen" is **roughly two minutes**. Design for it
rather than hiding it: a visible pipeline with named stages beats a spinner.

Suggested stages, all independently observable from the UI:

```
payment seen on XRPL  →  attestation requested  →  round finalizing  →  proof fetched  →  settled ✓
```

The first stage is checkable directly (§6.2). The last is checkable directly (invoice
status flips). The middle stages are the attester's; if you want them live, it needs to
expose them (§7) — otherwise show the first and last and mark the middle as "proving".

---

## 6. How to test everything, without the backend

### 6.1 Read live state right now

The registry already has two invoices with **both** outcomes on it — one settled, one
delinquent. This is real data from a real end-to-end run, so the UI has something
meaningful to render on day one.

```bash
curl -s -X POST https://coston2-api.flare.network/ext/C/rpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{
        "to":"0x1267431d069c0F3587dbAA05c41d76e677bFaA4c",
        "data":"0x14d0f1ea"},"latest"]}'   # invoiceCount() → 2
```

Known-good values to assert against:

| | Invoice 1 | Invoice 2 |
| --- | --- | --- |
| Tag | 1 | 2 |
| Amount | 5 XRP | 7 XRP |
| Status | `2` Settled | `3` Delinquent |

Payer for both: `rnhHC8ST7RtksLBVmLTRQZ7CvcigJQprQt`
→ hash `0xfc2000c1cc37efcc6cad8046042a9c81f79fd59b8c80dba6a5517a7334fbf4fc`
→ record: 1 settled (5000000 drops) / 1 delinquent (7000000 drops)

Payee: `rLthLtDGxNQSTz3m2uYWmM891gpHqBe7fs`

### 6.2 Detect a payment on the XRPL yourself

The UI can confirm "payment seen" without any backend, which makes the first pipeline stage
real rather than simulated:

```js
const res = await fetch(XRPL_RPC, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ method: "account_tx", params: [{
    account: payeeAddress, ledger_index_min: Number(inv.minimalBlockNumber),
    ledger_index_max: -1, limit: 200 }] })
});
const { result } = await res.json();
const match = result.transactions.find(t => {
  const tx = t.tx_json ?? t.tx;
  return tx?.TransactionType === "Payment"
      && tx.Destination === payeeAddress
      && Number(tx.DestinationTag) === Number(inv.destinationTag);
});
```

### 6.3 Fixtures for states you can't produce on demand

Build every screen against these first — they cover states that are slow or impossible to
trigger by hand.

```js
export const FIXTURES = {
  open: {
    issuer: "0x56c72d45C14acc183D42f0eB3B5A6A484531D091",
    destinationTag: 3, status: 1,
    payeeAddressHash: "0x49ed1d1fbbb168b407d0836c6b3f900bc2551f017ae28f183c6ae3c41ec56b29",
    amountDrops: 10000000n,
    minimalBlockNumber: 19625845n, deadlineBlockNumber: 19626145n,
    deadlineTimestamp: BigInt(Math.floor(Date.now()/1000) + 600),
    payerAddressHash: "0xfc2000c1cc37efcc6cad8046042a9c81f79fd59b8c80dba6a5517a7334fbf4fc",
    settledByAddressHash: "0x" + "0".repeat(64), outcomeTimestamp: 0n, metadataURI: ""
  },
  settled:    { /* as above, status: 2, settledByAddressHash = payerAddressHash */ },
  delinquent: { /* as above, status: 3, settledByAddressHash = zero              */ },
  bearer:     { /* as above, payerAddressHash = zero hash                         */ },

  records: {
    empty:      { settledCount:0n, delinquentCount:0n, settledDrops:0n, delinquentDrops:0n, lastOutcomeTimestamp:0n },
    live:       { settledCount:1n, delinquentCount:1n, settledDrops:5000000n, delinquentDrops:7000000n, lastOutcomeTimestamp:1785843351n },
    strong:     { settledCount:14n, delinquentCount:0n, settledDrops:1400000000n, delinquentDrops:0n, lastOutcomeTimestamp:1785843351n }
  },

  scores: {
    none:      { score: 0,   band: "none",      basis: 0,  version: "quittance-score-1" },
    thin:      { score: 546, band: "poor",      basis: 1,  version: "quittance-score-1" },
    live:      { score: 516, band: "poor",      basis: 2,  version: "quittance-score-1" },
    excellent: { score: 828, band: "excellent", basis: 14, version: "quittance-score-1" }
  }
};
```

### 6.4 Produce a real end-to-end run in ~3 minutes

If you want to watch the whole thing happen live:

```bash
cd services/attester && npm install && cp .env.example .env   # fill PRIVATE_KEY, INVOICE_REGISTRY
node bin/quittance.js fund                                    # funded XRPL testnet account
node bin/quittance.js create --payee rPAYEE --payer rPAYER --xrp 5 --minutes 10
node bin/quittance.js pay --seed sSEED --to rPAYEE --tag N --xrp 5
node bin/quittance.js settle --invoice N --tx HASH            # ~2 min, prints each stage
```
Swap the last two for "do nothing, wait past the deadline, then `mark --invoice N`" to
watch the delinquency path.

### 6.5 Error states the UI must handle

These are real reverts from the contract, not hypotheticals — each has a custom error:

| Error | When | Suggested copy |
| --- | --- | --- |
| `InvoiceNotOpen` | Settle/mark an already-decided invoice | "This invoice already has an outcome." |
| `ProofMismatch(field)` | Proof doesn't match invoice terms | Name the field — usually `destinationTag` (payer forgot the tag) |
| `PaidAfterDeadline` | Payment landed late | "Paid, but after the deadline — the invoice still lapses." |
| `PaymentFailed(status)` | XRPL tx failed | `1` = sender's fault, `2` = receiver's fault |
| `NoSuchInvoice` | Bad id or tag | 404 state |
| `InvalidProof` | FDC rejected it | Transient — usually means the round isn't finalized yet |

Decode with `contract.interface.parseError(err.data)`.

---

## 7. If you want live pipeline stages

The attester (`services/attester`) currently has no HTTP surface — it's a CLI plus a
`watch` daemon that logs to stderr. If the UI wants live "requested / finalizing / proof
fetched" stages rather than inferring them, tell me and I'll add a small read-only
endpoint:

```
GET /api/invoices/:id/progress
→ { stage: "round_finalizing", votingRoundId: 1415700, since: 1785843200 }
```

Say the word and it's maybe an hour of work. Until then, infer from what's public:
XRPL payment visible (§6.2) + on-chain status = enough for a two-state pipeline.

---

## 8. Performance notes

- **Don't loop `getInvoice` over hundreds of ids.** Read `InvoiceCreated` events instead
  (indexed on `invoiceId`, `destinationTag`, `issuer`), then fetch only the invoices you
  render. `InvoiceSettled` and `InvoiceMarkedDelinquent` are indexed on
  `payerAddressHash`, which makes a per-account history view cheap.
- Poll the chain every ~15–20 s. Coston2 blocks are ~2 s but nothing here changes faster
  than the FDC round.
- `apps/web/vendor/ethers.umd.min.js` is vendored so the reference page works offline —
  use your own bundler, ignore that file.

---

## 9. Current backend status

| Piece | State |
| --- | --- |
| `InvoiceRegistry` on Coston2 | Live, both outcome paths exercised end-to-end |
| Attester CLI + watcher | Working; no HTTP API yet (§7) |
| `ScoreInstructionSender` + FCE registration | Registered, extension `66012` |
| Scoring model + in-enclave registry reader | Built and tested against live Coston2 data |
| TEE image | Built, runs, verified reproducible (5.93 MB distroless) |
| TEE machine registration | Needs a Confidential Space VM — the score endpoint isn't live yet |

**Build the score screen against fixtures.** Everything else is live now.

---

## 10. Design steers

- **Two outcomes, equal weight.** Don't treat delinquency as an error state — it's half the
  product and the half nobody else can do. It deserves the same visual investment as the
  receipt.
- **The destination tag is the product surface.** If a payer misses it, everything fails.
  It should be the largest, most copyable thing on the pay screen.
- **Permanence is the value proposition.** Both outcomes are irreversible. Say so.
- **Don't overclaim on the score.** Show `basis`. A confident-looking number backed by two
  invoices would be the dishonest version of this screen, and a judge will poke at it.
- **Two minutes is the real latency.** A pipeline with named stages reads as rigor. A
  spinner for two minutes reads as broken.
