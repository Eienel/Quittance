# Contributing to Quittance

Built for [Flare Summer Signal](https://dorahacks.io/hackathon/flaresummersignal/detail).
Submission deadline **14 August 2026**, so the bias is toward small, frequent, mergeable PRs
over long-lived branches.

## Who owns what

| Area | Path | Owner |
| --- | --- | --- |
| Contracts, attester, TEE scorer | `contracts/`, `services/`, `fce/` | backend |
| Web app — visual layer | `apps/web/src/components/`, `src/routes/`, `src/styles.css` | frontend |
| Web app — data layer | `apps/web/src/lib/`, `src/hooks/` | backend (coordinate before changing) |

The data layer is tested against the live chain. If you need it to expose something it
doesn't, open an issue or ping rather than reworking the fetching — it's usually a
five-minute addition on our side.

## Workflow

```bash
# one-time
gh repo fork Eienel/Quittance --clone   # or fork in the UI and clone your fork
cd Quittance
git remote add upstream https://github.com/Eienel/Quittance.git

# per change
git fetch upstream
git checkout -b feat/pay-screen upstream/main
# …work…
npm --prefix apps/web run typecheck && npm --prefix apps/web test
git push -u origin feat/pay-screen
gh pr create --repo Eienel/Quittance
```

Keep PRs to one concern. A redesign of the pay screen is one PR; a design-system pass is
another.

## Before you open a PR

```bash
cd apps/web
npm run typecheck    # strict tsc, must be clean
npm test             # hermetic unit tests
npm run build        # must succeed
```

If you touched anything under `src/lib/`, also run `LIVE=1 npm test` — it reads the real
Coston2 registry and will catch a broken decode that typechecks fine.

Screenshots in the PR body for anything visual, please. Before/after if you're changing
something that already existed.

## Conventions

- **TypeScript is strict.** No `any` in new code without a comment saying why.
- **`bigint` for on-chain integers**, all the way to the point of display. Converting early
  loses precision on drop amounts.
- **Comments explain why, not what.** The repo leans on this; match it.
- **No new dependencies without a note in the PR.** The app currently runs on React, Vite,
  ethers and react-router, and a small dependency tree is worth protecting. A QR library is
  pre-approved — the pay screen needs one.
- **Never commit a private key or `.env`.** `.env` is gitignored; keep it that way. The app
  never needs a key — users sign with their own wallet.

## Testing against real state

The registry on Coston2 already holds two real invoices with both outcomes, so there's
meaningful data to render on day one:

| | Invoice 1 | Invoice 2 |
| --- | --- | --- |
| Tag | 1 | 2 |
| Amount | 5 XRP | 7 XRP |
| Outcome | settled | delinquent |

Payer `rnhHC8ST7RtksLBVmLTRQZ7CvcigJQprQt` → 1 settled / 1 delinquent.

To produce your own end-to-end run (~3 min), see `services/attester` and
[`docs/FRONTEND_SPEC.md`](docs/FRONTEND_SPEC.md) §6.4.

You'll need C2FLR for gas: https://faucet.flare.network/coston2

## Reference

- [`docs/FRONTEND_SPEC.md`](docs/FRONTEND_SPEC.md) — full product/data spec
- [`apps/web/README.md`](apps/web/README.md) — app-specific guide, fixtures, gotchas
- [`apps/reference/index.html`](apps/reference/index.html) — the original vanilla-JS page.
  Superseded by `apps/web`, kept because it's a single file that proves the wiring with no
  build step.
