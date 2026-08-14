#!/usr/bin/env node
/**
 * Attacks the live registry with proofs that are *genuine and true*.
 *
 * Every attestation this script obtains is confirmed by the Flare Data Connector. None
 * of them is forged, malformed, or replayed. Each one nonetheless asserts something that
 * would be false about the invoice it is aimed at, and a naive integration - verify the
 * Merkle proof, then act - would accept all of them.
 *
 * That is the point worth demonstrating: on Flare the hard part is not getting a proof,
 * it is establishing that the proof you got is about the obligation in front of you.
 *
 * Writes a JSON artifact the web app renders, so the claims on screen are the output of
 * a run rather than prose.
 *
 *   node bin/adversary.js --settled 2 --victim 5
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const fdc = require("../src/fdc");
const reg = require("../src/registry");
const cfg = require("../src/config");

const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

function args() {
  const out = {};
  const rest = process.argv.slice(2);
  for (let i = 0; i < rest.length; i += 2) out[rest[i].replace(/^--/, "")] = rest[i + 1];
  return out;
}

/** Turn a revert into the custom error name the contract used. */
function errorName(err) {
  const data = err?.data ?? err?.error?.data ?? err?.info?.error?.data;
  try {
    const parsed = reg.registry(fdc.provider()).interface.parseError(data);
    return parsed ? `${parsed.name}(${parsed.args.map(String).join(", ")})` : null;
  } catch {
    return null;
  }
}

/**
 * Attack 1 - the cherry-picked window.
 *
 * Take an invoice that was genuinely paid, and ask the FDC to prove that no payment
 * matching its terms exists inside a *narrow slice* of its ledger range, chosen to sit
 * before the payment landed. The FDC confirms it, because it is true: in those few
 * ledgers, nothing arrived.
 *
 * The proof is real. The conclusion "this invoice went unpaid" is not. The registry
 * refuses it because a nonexistence proof means nothing unless it was requested over the
 * exact window the invoice fixed at issuance.
 */
async function cherryPickedWindow(invoiceId) {
  const inv = await reg.getInvoice(invoiceId);
  log(`invoice ${invoiceId} is ${["None", "Open", "Settled", "Delinquent"][Number(inv.status)]}`);

  // A five-ledger slice at the very end of the invoice's range. The payment settled this
  // invoice early - as real payments to a known deadline usually do - so a window pressed
  // up against the deadline genuinely contains no matching payment, and the FDC will
  // confirm its absence there. The slice is still *inside* the invoice's declared range,
  // which is exactly what the registry refuses to accept as a proof about the whole range.
  const narrowStart = inv.deadlineBlockNumber - 5n;

  log(
    `requesting nonexistence over ledgers ${narrowStart}–${inv.deadlineBlockNumber} ` +
      `(the invoice's real range starts back at ${inv.minimalBlockNumber})`
  );

  // Build the request explicitly: `inv` is an ethers Result, and spreading it would
  // yield indexed properties rather than the named ones prepareNonexistenceRequest reads.
  const encoded = await fdc.prepareNonexistenceRequest({
    payeeAddressHash: inv.payeeAddressHash,
    amountDrops: inv.amountDrops,
    destinationTag: inv.destinationTag,
    minimalBlockNumber: narrowStart,
    deadlineBlockNumber: inv.deadlineBlockNumber,
    deadlineTimestamp: inv.deadlineTimestamp,
  });

  const proof = await fdc.obtainProof(encoded, fdc.XRP_NONEXISTENCE_RESPONSE, log);
  log("the FDC confirmed it - the attestation is genuine and its statement is true");

  try {
    await (await reg.registry().markDelinquent(invoiceId, proof)).wait();
    return {
      name: "Cherry-picked window",
      live: true,
      blocked: false,
      detail: "THE REGISTRY ACCEPTED IT: a paid invoice was marked delinquent.",
    };
  } catch (err) {
    const reason = errorName(err) ?? err.shortMessage ?? err.message;
    log(`rejected: ${reason}`);
    return {
      name: "Cherry-picked window",
      live: true,
      blocked: true,
      claim:
        "A genuine, FDC-confirmed proof that no payment arrived, over a five-ledger slice chosen to exclude the payment that actually settled this invoice.",
      whyItFools:
        "A naive integration verifies the Merkle proof and marks the invoice. Every field it would check is authentic.",
      defence:
        "markDelinquent requires the proof's request body to reproduce the invoice's own search range, amount, payee and destination tag.",
      reason,
    };
  }
}

/**
 * Attack 2 - the fabricated debt.
 *
 * Anyone may write an invoice naming anyone as the payer. Let one lapse and the
 * nonexistence proof is entirely truthful: nobody paid. But nobody agreed to owe
 * anything either, so the mark stands against the invoice and reaches no record.
 *
 * Read from chain rather than executed, because the seeded dataset already contains it.
 */
async function fabricatedDebt(invoiceId) {
  const inv = await reg.getInvoice(invoiceId);
  const record = await reg.registry(fdc.provider()).record(inv.payerAddressHash);

  const marked = Number(inv.status) === 3;
  const untouched = record.delinquentCount === 0n;

  return {
    name: "Fabricated debt",
    live: true,
    blocked: marked && untouched,
    claim:
      "A truthful proof that an invoice naming an innocent account went unpaid, for a debt that account never agreed to.",
    whyItFools:
      "The proof is impeccable. Nothing in an attestation can say whether the obligation was ever real.",
    defence:
      "A delinquency reaches a payment record only if the named debtor admitted the debt first, by making any payment carrying the invoice's destination tag from their own XRPL account.",
    reason: marked
      ? `invoice marked delinquent; payer record still ${record.delinquentCount} delinquent / ${record.settledCount} settled`
      : "invoice not marked",
  };
}

/**
 * Attack 3 - cross-chain substitution.
 *
 * The same request aimed at a different XRPL network. On mainnet the payee address and
 * destination tag are meaningless, so "no such payment" is trivially true there.
 *
 * NOT executable on Coston2: its FDC attests exactly one pair, (XRPPaymentNonexistence,
 * testXRP), and the verifier refuses the request before the FDC sees it. The registry
 * checks the origin anyway - a security property that rests on an upstream service's
 * current configuration is a property you will lose the moment that configuration
 * changes, and Flare is actively adding sources.
 */
async function crossChainSubstitution() {
  const toBytes32 = (s) =>
    "0x" + Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");

  const res = await fetch(
    `${cfg.verifierBase}/verifier/xrp/XRPPaymentNonexistence/prepareRequest`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": cfg.verifierApiKey },
      body: JSON.stringify({
        attestationType: toBytes32("XRPPaymentNonexistence"),
        sourceId: toBytes32("XRP"), // mainnet, not this registry's chain
        requestBody: {
          minimalBlockNumber: "19625000",
          deadlineBlockNumber: "19625400",
          deadlineTimestamp: "1785000000",
          destinationAddressHash: ethers.ZeroHash,
          amount: "1",
          checkFirstMemoData: false,
          firstMemoDataHash: ethers.ZeroHash,
          checkDestinationTag: true,
          destinationTag: "1",
          proofOwner: ethers.ZeroAddress,
        },
      }),
    }
  );
  const body = await res.json().catch(() => ({}));

  return {
    name: "Cross-chain substitution",
    live: false,
    blocked: true,
    claim:
      "A nonexistence proof about XRP mainnet, aimed at an invoice that lives on testXRP. Trivially true there, and every request-body field would match.",
    whyItFools:
      "Verifying a Merkle proof establishes that an attestation is genuine, not that it is about the ledger your obligation lives on.",
    defence:
      "The registry pins its sourceId at deployment and checks it, alongside the attestation type, so the guarantee does not depend on how the verifier happens to be configured.",
    reason: `Coston2's verifier declines to produce this proof at all: ${
      (body.error ?? "").slice(0, 120) || `HTTP ${res.status}`
    }`,
    note:
      "Hardening rather than a live exploit on Coston2 today: its FDC attests only (XRPPaymentNonexistence, testXRP). Covered by ProofOrigin.test.js.",
  };
}

async function main() {
  const opts = args();
  const settledId = Number(opts.settled ?? 2);
  const victimId = Number(opts.victim ?? 5);

  const results = [];
  results.push(await cherryPickedWindow(settledId));
  results.push(await fabricatedDebt(victimId));
  results.push(await crossChainSubstitution());

  const generatedAt = new Date().toISOString();
  const artifact = {
    generatedAt,
    verifiedAt: generatedAt,
    registry: cfg.registryAddress,
    network: "coston2",
    results,
  };

  const out = path.join(__dirname, "..", "..", "..", "apps", "web", "src", "lib", "attacks.json");
  fs.writeFileSync(out, JSON.stringify(artifact, null, 2) + "\n");

  console.log(JSON.stringify(artifact, null, 2));
  log(`wrote ${out}`);

  const leaked = results.filter((r) => !r.blocked);
  if (leaked.length) {
    log(`FAILED: ${leaked.length} attack(s) were not blocked`);
    process.exitCode = 1;
  } else {
    log(`all ${results.length} attacks blocked`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
