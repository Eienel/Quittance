# Quittance Confidential

The scoring half of Quittance: a Flare Compute Extension that turns an account's
attested payment history into a creditworthiness score **without anyone seeing the
history** — including the machine operator and the caller.

## Why a TEE is load-bearing here

The registry is public by design; that is what makes its outcomes checkable. But a
payment history is commercially sensitive: who you invoice, for how much, and who
made you wait. A lender needs the *judgement*, not the ledger.

So the asymmetry across the enclave boundary is the entire product:

| | Crosses the boundary |
| --- | --- |
| **In** | one XRPL account hash, one registry address |
| **Out** | `{score, band, basis, version}` — a number in 300–850 |
| **Never out** | invoice counts, amounts, dates, counterparties, any per-invoice detail |

The enclave reads the full record from `InvoiceRegistry.record()` itself, summarizes it,
and drops it. `GET /state` exposes aggregate counters only — a per-account counter would
leak exactly what this exists to protect. The score is deliberately lossy: distinct
histories map to the same number, so the output is not a re-encoding of the input.

Attestation is what makes that a *checkable* claim rather than a promise: the machine's
identity and image hash are registered on-chain, so a caller verifies which code produced
their score.

## Layout

```
scorer/internal/score/       # the scoring model (pure, unit-tested)
scorer/internal/registry/    # in-enclave reader for InvoiceRegistry.record()
scorer/internal/extension/   # FCE handler: SCORING / SCORE_PAYER routing
scorer/pkg/types/            # wire types — note what the response omits
```

The on-chain entry point lives with the other Solidity, at
[`contracts/src/fce/ScoreInstructionSender.sol`](../contracts/src/fce/ScoreInstructionSender.sol),
so one `hardhat compile` covers the whole project.

## Scoring model (`quittance-score-1`)

Range 300–850, or 0 for an account with no attested history.

- **Quality** blends the settled ratio by count (0.4) and by value (0.6) — a large missed
  invoice says more than a small one, but a habit of missing small ones is still a signal.
- **Confidence** ramps over the first ~6 outcomes, so a thin file cannot read as an
  excellent one; sparse records sit near the 500 baseline.
- **Staleness** decays an idle record back toward baseline, so old good behaviour does not
  stand in for current behaviour.

## Status

Registered and live on Coston2:

| Thing | Value |
| --- | --- |
| `ScoreInstructionSender` | `0xfebD5Fa7e8f42d5fF05Aa2d6CEf00e98cafD8256` |
| Extension ID | `65940` |
| Registration tx | `0xd8cfaabeb085a710e352f7962f81070180339aac5f338fcf27718f46ca7aa798` |
| `FlareTeeManager` (Coston2) | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` |

Registration was **permissionless** — `register()` returns an extension id owned by the
caller, who then allowlists their own machine owners. No Foundation approval was involved.

Verified against live data: the reader pulls the real Coston2 record for the payer from the
end-to-end run (1 settled / 5 XRP, 1 delinquent / 7 XRP) and emits only
`{score: 516, band: "poor", basis: 2}`. Run it with `LIVE=1 go test ./internal/registry/`.

**Remaining:** building the reproducible Docker image and registering the TEE machine
requires a Docker daemon and a Confidential Space VM, neither available in the build
sandbox where this was developed. The extension is registered and its machine-owner
allowlist is set, so machine registration is the only step left.

## Running

```bash
cd scorer
go test ./...                              # scoring model + wire types
LIVE=1 go test ./internal/registry/ -v     # reads the live Coston2 registry
go run ./cmd                               # extension server on :8080
```
