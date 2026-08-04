# Quittance — Build Plan (v2, dual-bounty)

## One-sentence definition
Quittance is an invoicing protocol on Flare where any XRPL payment (from any wallet or exchange, matched by destination tag) produces a cryptographic outcome either way — an FDC-proved receipt if paid, or a permanent Merkle-proved delinquency mark if the deadline passes — plus a confidential compute extension that turns that payment history into a private credit score inside a TEE.

Name note: "quittance" is the historical term for a document discharging a debt — a receipt that the obligation is settled. Product tagline: "Every invoice ends in a quittance or a mark."

## Two-part product = two bounty entries
1. **Quittance Registry** (Bounty 1: Interoperable Asset Products) — invoice + proof-of-payment/proof-of-non-payment registry. PRIORITY. Must be end-to-end by Day 6.
2. **Quittance Confidential** (Bounty 2: Confidential Compute Apps) — a Flare Compute Extension (FCE) in Google Cloud Confidential Space that reads the registry and computes a private credit score; raw history never leaves the enclave, only score + attestation exit. BUILT ONLY IF part 1 is E2E by Day 6; otherwise it ships as a roadmap section.

## Hackathon facts (verified)
- Flare Summer Signal, DoraHacks: https://dorahacks.io/hackathon/flaresummersignal/detail
- Timeline: registration/dev opened June 29 · **final submission Aug 14, 2026** · judging Aug 15–21 · winners Aug 24
- Prizes: $6,000 per bounty — 1st $4,000, 2nd $2,000
- Judging: product usefulness + quality of Flare integration; judges test the demo where possible
- Existing projects allowed but must clearly separate what was newly built during the program
- Deployment on Coston2, Songbird, or Flare mainnet all accepted
- Submission must include: project name; selected bounty or bounties; short product description; target user; demo link/video/app; GitHub repo; explanation of how it uses Flare; what was newly built; contract addresses; short roadmap

## Verified technical findings — Part 1 (Registry)
- **`XRPPaymentNonexistence`** (attestation id `0x09`): asserts NO XRPL Payment matching destination + amount + (DestinationTag and/or first-Memo hash) confirmed in a ledger range. Chains: XRP mainnet + testXRP. Finality: 3 confirmations ≈ 12s.
  - Request: minimalBlockNumber, deadlineBlockNumber, deadlineTimestamp, destinationAddressHash, amount (drops), checkFirstMemoData/firstMemoDataHash, checkDestinationTag/destinationTag, proofOwner. At least one of the two check flags must be true.
  - Match rule (invalidates nonexistence): Payment type, receiver hash matches, amount greater than requested, status SUCCESS or RECEIVER_FAILURE, tag/memo criteria met.
  - Response: minimalBlockTimestamp, firstOverflowBlockNumber, firstOverflowBlockTimestamp. Range = [minimalBlockNumber, firstOverflowBlockNumber). Interface: `IXRPPaymentNonexistence`.
- **`XRPPayment`** (companion type): proves an XRPL payment incl. memo + destination tag → the "paid" path receipt.
- FDC flow: prepare request via verifier → submit to FdcHub → 50%+ data-provider signature weight → Merkle root on chain → fetch proof from DA layer → verify in contract.
- FDC voting rounds ≈ 90s — design the UX around the wait.
- Amounts in drops (1 XRP = 1,000,000 drops); DestinationTag is uint32.
- Coston2: chainId 114, RPC https://coston2-api.flare.network/ext/C/rpc, faucet gives C2FLR.
- FlareContractRegistry (same address on all networks): 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019 — resolve all protocol contracts through it, never hardcode.

## Verified technical findings — Part 2 (Confidential)
- FCC deployed to **Songbird** via governance vote STP.13 (July 6–13, 2026) — first Flare 2.0 delivery. Pre-production; mainnet later.
- FCEs = reproducible Docker images running in **Google Cloud Confidential Space (AMD SEV)**, wired to Flare contracts.
- On-chain building blocks: **TeeExtensionRegistry**, **TeeMachineRegistry**, InstructionSender pattern, OPType/OPCommand routing, instruction lifecycle, on-chain attestation of machine identity, reproducible builds.
- Protocol-level TEEs (PMW, fast FDC) are Foundation-operated during the Songbird rollout — that does NOT gate registering your own FCE.
- **Open verification (do first, ~10 min, before provisioning GCP):** read TeeMachineRegistry/TeeExtensionRegistry on Songbird/Coston and confirm external registration with an attestation proof succeeds today. If it reverts/permissioned → Part 2 becomes roadmap, no GCP spend.
- Precedent: Flare x Google hackathon (Mar 2025), 460 participants running TEEs on Confidential Space with vTPM attestations verified on Flare, using Flare AI Kit.

## Links index
Docs (append `.md` to any URL for markdown; full index: https://dev.flare.network/llms.txt)
- FDC overview: https://dev.flare.network/fdc/overview
- Attestation types index: https://dev.flare.network/fdc/attestation-types
- XRPPayment: https://dev.flare.network/fdc/attestation-types/xrp-payment
- XRPPaymentNonexistence: https://dev.flare.network/fdc/attestation-types/xrp-payment-nonexistence
- FDC guides: https://dev.flare.network/fdc/guides
- FDC reference: https://dev.flare.network/fdc/reference
- FCC overview: https://dev.flare.network/fcc/overview
- FCC developer guides: https://dev.flare.network/fcc/guides
- Network config: https://dev.flare.network/network/overview · FAQs: https://dev.flare.network/support/faqs

Repos
- Foundry starter: https://github.com/flare-foundation/flare-foundry-starter
- Hardhat starter: https://github.com/flare-foundation/flare-hardhat-starter
- Periphery (Solidity interfaces): https://github.com/flare-foundation/flare-foundry-periphery-package — also on npm as `@flarenetwork/flare-periphery-contracts`
- AI skills: https://github.com/flare-foundation/flare-ai-skills
- Flare AI Kit (TEE/Confidential Space reference)

Hackathon
- DoraHacks page: https://dorahacks.io/hackathon/flaresummersignal/detail
- Faucets: Coston2 faucet (C2FLR), XRPL testnet faucet (testXRP)
- Explorers: https://coston2-explorer.flare.network · https://flare-systems-explorer.flare.network

## Architecture
```
apps/web/                # invoice creation, pay instructions (QR + destination tag), status, registry, score page
contracts/src/
  InvoiceRegistry.sol    # create/settle/markDelinquent, one-outcome guard, record(payerHash) view
contracts/script/        # adapted from FDC guides: request, wait round, fetch DA proof, submit
services/attester/       # TS worker: deadline watcher → FDC request → DA proof fetch → on-chain submit
fce/                     # Part 2: reproducible Docker image for Confidential Space
  scorer/                # reads registry events, computes score in-enclave, signs with TEE identity
```
Core rules: invoice issues unique uint32 destinationTag; paid → settle() with XRPPayment proof (before deadline); unpaid → markDelinquent() with XRPPaymentNonexistence proof whose range params must exactly match the invoice (no cherry-picked windows); one outcome per invoice, permanent.

## Schedule (submission Aug 14)
- **Day 1:** Toolchain init. Run official FDC Payment guide unmodified on Coston2 (learn round/proof lifecycle). Swap to XRPPayment + XRPPaymentNonexistence on testXRP; confirm verifier accepts. ← remaining kill-risk for Part 1. Parallel 10-min check: TeeMachineRegistry external registration (decides Part 2).
- **Days 2–3:** InvoiceRegistry + proof verification + tests (mocked proofs). ✅ done
- **Days 4–5:** attester service; both proof paths E2E on Coston2 + XRPL testnet.
- **Day 6:** web UI; full demo flow works. **GATE: Part 2 go/no-go.**
- **Days 7–8 (if GO):** FCE — reproducible image, Confidential Space deploy, register extension + machine, scorer reads registry, score + attestation surfaced in UI. Keep scope minimal.
- **Day 9:** demo video (3–5 min), README, addresses, roadmap.
- **Day 10:** buffer; submit early.

## Demo script (what judges test)
1. Create invoice → XRPL address + destination tag + amount + short deadline.
2. Judge pays from any XRPL testnet wallet with the tag → receipt appears with proof.
3. Second invoice lapses → nonexistence proof → permanent mark; registry shows the payer's record.
4. (Part 2) Score page: score served from the FCE with TEE attestation; raw history shown as NOT exposed.

## Submission checklist
- [ ] Name: Quittance · bounties: both (or Bounty 1 only if gate failed)
- [ ] Target user: merchants/freelancers invoicing in XRP; lenders/counterparties reading the record
- [ ] Demo link + 3–5 min video · GitHub repo
- [ ] How it uses Flare: XRPPayment + XRPPaymentNonexistence via FDC on Coston2; FCE on Confidential Space registered via TeeExtensionRegistry (Part 2)
- [ ] Newly built: everything, during the program
- [ ] Contract addresses (Coston2; Songbird/Coston for FCE registries if used)
- [ ] Roadmap: mainnet; BTC/DOGE via ReferencedPaymentNonexistence; recurring invoices (dead-man switch); delinquency/score API for lenders; full private scoring when FCC reaches mainnet

## Interrogation history (why this and not other things)
- Killed: any-currency merchant gateway (pattern-completion; LI.FI/BitPay commodity), FAssets yield aggregator, bridge UX, FTSO trading agent, DAO tooling (sponsor-obvious, no named pain).
- Folded in: dead-man settlement = recurring invoice feature, not a project.
- Revived by research: private credit score (was archived when FCC looked Foundation-gated; un-archived when FCE registration via public registries + Confidential Space was confirmed solo-feasible).
- Mechanism moat: proof-of-absence (nonexistence attestations) is the rarest primitive on Flare and the two XRPL-specific types are weeks old — integration quality few competitors will match.
