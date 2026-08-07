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
| `ScoreInstructionSender` | `0xCf55db970F78adfD824B4B87f3b55c8901B47766` |
| Extension ID | `66014` |
| Registration tx | `0xd8cfaabeb085a710e352f7962f81070180339aac5f338fcf27718f46ca7aa798` |
| `FlareTeeManager` (Coston2) | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` |

Registration was **permissionless** — `register()` returns an extension id owned by the
caller, who then allowlists their own machine owners. No Foundation approval was involved.

Verified against live data: the reader pulls the real Coston2 record for the payer from the
end-to-end run (1 settled / 5 XRP, 1 delinquent / 7 XRP) and emits only
`{score: 516, band: "poor", basis: 2}`. Run it with `LIVE=1 go test ./internal/registry/`.

The image builds and runs: the Flare tee-node boots, the scorer binds, and `GET /state`
answers with aggregate counters only.

```
{"stateVersion":"0x302e312e30…","state":{"scoresComputed":0,"modelVersion":"quittance-score-1"}}
```

**Remaining:** registering the TEE machine, which needs a Google Cloud Confidential Space
VM (`MODE=0`, real vTPM attestation). The extension is registered and its machine-owner
allowlist is set, so that is the only step left before scores can be requested on-chain.

## Running

```bash
cd scorer
go test ./...                              # scoring model + wire types
LIVE=1 go test ./internal/registry/ -v     # reads the live Coston2 registry
go run ./cmd                               # extension server on :8080
```

## Building the image

The image is built for reproducibility: a digest-pinned base, `SOURCE_DATE_EPOCH`-clamped
timestamps, apt pinned to a Debian snapshot, and a static `CGO_ENABLED=0` binary on
distroless. Two builds of the same commit must produce the same image digest — that digest
is what the TEE attests to, so a reader can check that the score came from *this* code.

```bash
cd fce/scorer
SDE=$(git log -1 --format=%ct)
DOCKER_BUILDKIT=1 docker build --provenance=false \
  --build-arg SOURCE_DATE_EPOCH=$SDE \
  --output type=oci,dest=scorer-oci.tar,rewrite-timestamp=true .
```

`--provenance=false` is **required**, not cosmetic. BuildKit otherwise attaches a
provenance attestation containing the wall-clock build time, which changes the manifest
list digest on every build even when the image itself is identical — exactly the digest a
verifier would be comparing.

### Verified reproducible

Built twice from the same commit, the second time with `--no-cache`:

| | Result |
| --- | --- |
| All 16 layer digests | identical |
| Image config + RootFS hash | `8288dc928dab6e2d…` both times |
| Image manifest | `sha256:07c6db11a292344ff4ba96e56ff7ee5b5faef90563cecb572d069a7cc002fb9b` |

So the digest a TEE attests to is a function of the source, not of when or where it was
built — which is what makes "this score came from this code" checkable by a third party.

> One caveat on the numbers above: they were produced in a sandbox whose egress proxy
> required an extra CA in the builder stage, added in a throwaway copy of the build context
> rather than in the committed `Dockerfile`. The committed Dockerfile is the canonical one;
> digests from a clean network will differ from those listed here and should be
> re-established once, then pinned.

`MODE` in the Dockerfile is `1` (simulated attestation) so a bare `docker run` works
locally. **A real Confidential Space deploy must set `MODE=0`** — the Flare TEE data
committee rejects simulated attestation.
