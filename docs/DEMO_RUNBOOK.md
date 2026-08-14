# Plime demo runbook

Use the existing seeded Coston2 state for the recording. Creating and resolving a brand-new
invoice is optional and adds an unpredictable FDC voting-round wait.

## The opening

Lead with the mechanism and the product space, not invoicing:

> Plime is an obligation and reputation primitive for products that depend on whether an
> external payment happened before a deadline. Flare supplies the attested fact. Plime binds
> it to an acknowledged obligation, resolves value, and records the outcome as reusable
> reputation.

Open `/primitive` while naming the first product families:

- bonded deposits and guarantees;
- tokenized-credit coupons and redemptions;
- recurring or deadline-shaped service commitments;
- invoices as the working reference product.

## Stable live recording path

Production currently remains at `https://quittance-azure.vercel.app` while the Vercel project
alias catches up with the Plime rename.

1. `/primitive`: show that the same registry operations serve several obligation types.
2. `/invoices/2`: the receipt path. A 5 XRP payment settled the obligation through
   `XRPPayment`.
3. `/invoices/3`: the acknowledged Mark path. The deadline passed and
   `XRPPaymentNonexistence` recorded delinquency.
4. `/invoices/4`: the consequence. A 2 FLR bond was forfeited to the issuer when the Mark
   was recorded.
5. `/invoices/5`: the consent defence. The fabricated debt is marked, but it is
   unacknowledged and does not touch the named account's payment record.
6. `/attacks`: show the window, fabricated-debt and source-chain defences.
7. `/record`: look up `rnhHC8ST7RtksLBVmLTRQZ7CvcigJQprQt` to show the accumulated live
   payment record.
8. `/score?fixtures=1`: show the confidential scorer output as a clearly labelled fixture
   preview. Do not describe it as a live enclave result.

Avoid invoice #1. It is an older lapsed artifact from the original seed attempt.

## Coston2 gas tokens

1. Install MetaMask or another EVM wallet.
2. In Plime, click **Connect**. The app requests Flare Coston2, chain ID `114`, and can add
   the network if it is missing.
3. Open the official Flare faucet: `https://faucet.flare.network/coston2`.
4. Paste the connected `0x` wallet address and request C2FLR.
5. Wait for the balance to appear before recording a create, bond, settle, or mark action.

C2FLR is testnet gas only and has no monetary value.

## XRP Testnet funds

The XRP payment happens on XRPL Testnet, not in MetaMask.

1. Create and fund a test account with the official XRPL faucet endpoint:
   `https://faucet.altnet.rippletest.net/accounts`.
2. Treat the returned test seed like a password while recording. Never show it on screen,
   commit it, paste it into chat, or reuse it for XRPL Mainnet.
3. Use a testnet-capable XRPL wallet to scan the payment QR, or use the local CLI:

   ```bash
   cd services/attester
   npm install
   node bin/plime.js pay --seed sTESTNET_SEED --to rPAYEE --tag DESTINATION_TAG --xrp AMOUNT
   ```

4. The destination tag is mandatory. A payment without it reaches the payee but cannot be
   matched to the obligation.

## If recording a brand-new live outcome

1. Connect the funded Coston2 wallet.
2. Create the invoice in Plime and copy its destination tag.
3. Pay from the funded XRPL Testnet account, including the exact destination tag.
4. Wait about 12 seconds for XRPL finality.
5. Trigger **Prove payment & settle** in Plime.
6. Leave the tab open while the FDC voting round finalizes and the browser retrieves the
   Merkle proof. Budget roughly two to three minutes.
7. Show the Coston2 transaction link after settlement.

For a live Mark, the deadline and ledger window must both pass before requesting
`XRPPaymentNonexistence`; this is slower and less predictable than the seeded demo.

## Claims to keep precise

- FDC provides the payment or non-payment attestation. Plime did not invent the FDC
  nonexistence primitive.
- Plime binds the proof to one obligation, enforces one permanent outcome, resolves an
  optional bond, protects reputation with acknowledgement, and accumulates reusable records.
- Extension `66014` and its sender are on Coston2, but no TEE machine or result proxy is live.
  The score screen is a fixture preview.
