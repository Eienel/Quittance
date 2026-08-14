#!/usr/bin/env node
/**
 * Seeds a fresh registry with the three states a demo needs to tell the story:
 *
 *   1. settled     — paid on time, proved with XRPPayment
 *   2. delinquent  — acknowledged, then left unpaid, proved with XRPPaymentNonexistence
 *   3. unclaimed   — a fabricated debt the named payer never admitted: marked, but
 *                    deliberately absent from their record
 *   4. forfeited   — bonded, acknowledged, then missed: the mark hands the bond over
 *
 * The third is the point of the acknowledgement mechanism, so a judge can see both
 * that the mark is real and that it does not touch an innocent account.
 *
 * Takes ~10 minutes: each proof needs one FDC voting round.
 */
const xrplSide = require("../src/xrpl");
const reg = require("../src/registry");

const PAYEE = process.env.SEED_PAYEE;
const PAYER = process.env.SEED_PAYER;
const PAYER_SEED = process.env.SEED_PAYER_SEED;
const VICTIM = process.env.SEED_VICTIM ?? "rNoSuchInnocentAccountEver12345";

const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

async function create({ xrp, minutes, payer, memo, bondFlr }) {
  const { ledgerIndex, closeTimeUnix } = await xrplSide.ledgerNow();
  const created = await reg.createInvoice({
    payeeAddressHash: xrplSide.addressHash(PAYEE),
    payerAddressHash: xrplSide.addressHash(payer),
    amountDrops: BigInt(Math.round(xrp * 1e6)),
    minimalBlockNumber: ledgerIndex,
    deadlineBlockNumber: ledgerIndex + Math.ceil((minutes * 60) / 4),
    deadlineTimestamp: closeTimeUnix + minutes * 60,
    // The payee address is published so a shared link is payable by someone who
    // has never seen the invoice; the chain itself stores only its hash.
    metadataURI: JSON.stringify({ payee: PAYEE, memo }),
  });
  log(`invoice ${created.invoiceId} created, tag ${created.destinationTag}, ${xrp} XRP`);

  if (bondFlr) {
    const { ethers } = require("ethers");
    const tx = await reg.registry().postBond(created.invoiceId, {
      value: ethers.parseEther(String(bondFlr)),
    });
    await tx.wait();
    log(`  bonded ${bondFlr} FLR`);
  }

  return { id: Number(created.invoiceId), tag: Number(created.destinationTag) };
}

const pay = async (tag, xrp) => {
  const res = await xrplSide.payInvoice({
    seed: PAYER_SEED,
    destination: PAYEE,
    destinationTag: tag,
    amountDrops: BigInt(Math.round(xrp * 1e6)),
  });
  log(`paid ${xrp} XRP with tag ${tag}: ${res.hash}`);
  return res.hash;
};

async function main() {
  if (!PAYEE || !PAYER || !PAYER_SEED) {
    throw new Error("set SEED_PAYEE, SEED_PAYER and SEED_PAYER_SEED");
  }

  // 1 — the receipt.
  const settled = await create({ xrp: 5, minutes: 30, payer: PAYER, memo: "Design work, March" });
  const payHash = await pay(settled.tag, 5);
  await reg.settleWithPayment(settled.id, payHash, log);

  // 2 — the mark, against a debt the payer admitted. A single drop is the admission.
  const marked = await create({ xrp: 7, minutes: 4, payer: PAYER, memo: "Consulting, April" });
  const ackHash = await pay(marked.tag, 0.000001);
  await reg.acknowledge(marked.id, ackHash, log);

  // 4 — bonded and missed: the proof does not merely record the outcome, it moves money.
  const forfeited = await create({
    xrp: 12,
    minutes: 4,
    payer: PAYER,
    memo: "Bonded obligation — the mark hands the bond to the creditor",
    bondFlr: 2,
  });
  const forfeitAck = await pay(forfeited.tag, 0.000001);
  await reg.acknowledge(forfeited.id, forfeitAck, log);

  // 3 — a fabricated debt: nobody acknowledges it, so nobody's record should move.
  const fabricated = await create({
    xrp: 1000,
    minutes: 4,
    payer: VICTIM,
    memo: "Fabricated debt — demonstrates that an unacknowledged mark reaches no record",
  });

  // Wait out both 4-minute deadlines plus a finality margin before proving absence.
  log("waiting for deadlines to pass…");
  for (;;) {
    const { closeTimeUnix, ledgerIndex } = await xrplSide.ledgerNow();
    const inv = await reg.getInvoice(fabricated.id);
    if (
      closeTimeUnix > Number(inv.deadlineTimestamp) &&
      ledgerIndex > Number(inv.deadlineBlockNumber) + 3
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 20_000));
  }

  await reg.markDelinquent(marked.id, log);
  await reg.markDelinquent(fabricated.id, log);
  await reg.markDelinquent(forfeited.id, log);

  const rec = await reg.registry(require("../src/fdc").provider()).record(
    xrplSide.addressHash(PAYER)
  );
  log("payer record:", {
    settled: Number(rec.settledCount),
    delinquent: Number(rec.delinquentCount),
  });

  const victimRec = await reg
    .registry(require("../src/fdc").provider())
    .record(xrplSide.addressHash(VICTIM));
  const { ethers } = require("ethers");
  const issuerAddr = new ethers.Wallet(require("../src/config").privateKey).address;
  const owed = await reg.registry(require("../src/fdc").provider()).withdrawable(issuerAddr);
  log(`bond forfeited to issuer: ${ethers.formatEther(owed)} FLR withdrawable`);

  log("victim record (must be empty):", {
    settled: Number(victimRec.settledCount),
    delinquent: Number(victimRec.delinquentCount),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
