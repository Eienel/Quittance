#!/usr/bin/env node
/**
 * quittance — drive an invoice from issuance to its outcome.
 *
 *   fund                                     create + fund a fresh XRPL testnet account
 *   create --payee r.. [--payer r..] --xrp N --minutes M [--memo URI]
 *   pay --to r.. --tag T --xrp N [--seed s..]
 *   acknowledge --invoice I --tx HASH        admit the debt (any payment from the payer)
 *   settle --invoice I --tx HASH             run the XRPPayment proof pipeline
 *   mark --invoice I                         run the XRPPaymentNonexistence pipeline
 *   status --invoice I
 *   record --address r..
 *   watch --payee r.. [--seconds 30]         drive every open invoice to an outcome
 */
const { ethers } = require("ethers");
const xrplSide = require("../src/xrpl");
const reg = require("../src/registry");

function args() {
  const [, , cmd, ...rest] = process.argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    opts[rest[i].replace(/^--/, "")] = rest[i + 1];
  }
  return { cmd, opts };
}

const XRP = (n) => BigInt(Math.round(Number(n) * 1e6)); // XRP → drops

const STATUS = ["None", "Open", "Settled", "Delinquent"];

function printInvoice(inv) {
  console.log({
    status: STATUS[Number(inv.status)],
    acknowledged: inv.acknowledged,
    destinationTag: Number(inv.destinationTag),
    amountDrops: inv.amountDrops.toString(),
    payeeAddressHash: inv.payeeAddressHash,
    payerAddressHash: inv.payerAddressHash,
    range: `[${inv.minimalBlockNumber}, ${inv.deadlineBlockNumber}] until ${inv.deadlineTimestamp}`,
    settledBy: inv.settledByAddressHash,
    outcomeTimestamp: Number(inv.outcomeTimestamp),
    metadataURI: inv.metadataURI,
  });
}

async function createInvoice(opts) {
  const { ledgerIndex, closeTimeUnix } = await xrplSide.ledgerNow();
  const minutes = Number(opts.minutes ?? 10);
  // XRPL closes a ledger roughly every 4 s.
  const deadlineBlockNumber = ledgerIndex + Math.ceil((minutes * 60) / 4);
  const created = await reg.createInvoice({
    payeeAddressHash: xrplSide.addressHash(opts.payee),
    payerAddressHash: opts.payer ? xrplSide.addressHash(opts.payer) : ethers.ZeroHash,
    amountDrops: XRP(opts.xrp),
    minimalBlockNumber: ledgerIndex,
    deadlineBlockNumber,
    deadlineTimestamp: closeTimeUnix + minutes * 60,
    metadataURI: opts.memo ?? "",
  });
  console.log({
    invoiceId: Number(created.invoiceId),
    destinationTag: Number(created.destinationTag),
    payTo: opts.payee,
    amountXrp: Number(opts.xrp),
    deadline: new Date((closeTimeUnix + minutes * 60) * 1000).toISOString(),
    txHash: created.txHash,
  });
}

/**
 * The daemon: for every open invoice addressed to `payee`, either find the
 * matching XRPL payment and settle, or — once the ledger is safely past the
 * deadline — request the nonexistence proof and mark.
 */
async function watch(opts) {
  const payee = opts.payee;
  const interval = Number(opts.seconds ?? 30) * 1000;
  const payeeHash = xrplSide.addressHash(payee);
  const busy = new Set();

  const xrpl = require("xrpl");
  const cfg = require("../src/config");

  async function paymentsTo(tag, minLedger) {
    const client = new xrpl.Client(cfg.xrplWss);
    await client.connect();
    try {
      const res = await client.request({
        command: "account_tx",
        account: payee,
        ledger_index_min: minLedger,
        ledger_index_max: -1,
        limit: 200,
      });
      // Amount matters now: a sub-amount payment is the debtor admitting the debt,
      // not settling it. Submitting it to settle() would burn a 90 s FDC round and
      // then revert, every cycle.
      return res.result.transactions
        .map((entry) => {
          const t = entry.tx_json ?? entry.tx;
          if (
            !t ||
            t.TransactionType !== "Payment" ||
            t.Destination !== payee ||
            Number(t.DestinationTag) !== Number(tag)
          ) {
            return null;
          }
          const delivered = entry.meta?.delivered_amount ?? t.Amount;
          return {
            hash: entry.hash ?? t.hash,
            drops: typeof delivered === "string" ? BigInt(delivered) : 0n,
          };
        })
        .filter(Boolean);
    } finally {
      await client.disconnect();
    }
  }

  console.error(`watching invoices payable to ${payee}...`);
  for (;;) {
    try {
      const r = reg.registry(require("../src/fdc").provider());
      const count = Number(await r.invoiceCount());
      const { ledgerIndex, closeTimeUnix } = await xrplSide.ledgerNow();

      for (let id = 1; id <= count; id++) {
        if (busy.has(id)) continue;
        const inv = await r.getInvoice(id);
        if (Number(inv.status) !== 1 /* Open */) continue;
        if (inv.payeeAddressHash !== payeeHash) continue;

        const run = async (label, fn) => {
          busy.add(id);
          console.error(`invoice ${id}: ${label}`);
          try {
            await fn();
          } catch (err) {
            console.error(`invoice ${id}: ${label} failed: ${err.message}`);
          } finally {
            busy.delete(id);
          }
        };

        const payments = await paymentsTo(inv.destinationTag, Number(inv.minimalBlockNumber));
        const settling = payments.find((p) => p.drops >= inv.amountDrops);
        const admitting = payments.find((p) => p.drops > 0n);

        if (settling) {
          run("payment seen, settling", () => reg.settleWithPayment(id, settling.hash));
        } else if (admitting && !inv.acknowledged && inv.payerAddressHash !== ethers.ZeroHash) {
          // Not enough to settle, but enough to admit the debt — which is what lets a
          // later mark count against the payer's record.
          run("partial payment seen, acknowledging", () => reg.acknowledge(id, admitting.hash));
        } else if (
          closeTimeUnix > Number(inv.deadlineTimestamp) &&
          ledgerIndex > Number(inv.deadlineBlockNumber) + 3 // past finality margin
        ) {
          run("deadline passed, marking delinquent", () => reg.markDelinquent(id));
        }
      }
    } catch (err) {
      console.error(`watch iteration failed: ${err.message}`);
    }
    await new Promise((res) => setTimeout(res, interval));
  }
}

async function main() {
  const { cmd, opts } = args();
  switch (cmd) {
    case "fund": {
      const acct = await xrplSide.fundNewAccount();
      console.log(acct);
      break;
    }
    case "create":
      await createInvoice(opts);
      break;
    case "pay": {
      const res = await xrplSide.payInvoice({
        seed: opts.seed,
        destination: opts.to,
        destinationTag: opts.tag,
        amountDrops: XRP(opts.xrp),
      });
      console.log(res);
      break;
    }
    case "acknowledge":
      await reg.acknowledge(Number(opts.invoice), opts.tx);
      break;
    case "settle":
      await reg.settleWithPayment(Number(opts.invoice), opts.tx);
      break;
    case "mark":
      await reg.markDelinquent(Number(opts.invoice));
      break;
    case "status":
      printInvoice(await reg.getInvoice(Number(opts.invoice)));
      break;
    case "record": {
      const r = reg.registry(require("../src/fdc").provider());
      const rec = await r.record(xrplSide.addressHash(opts.address));
      console.log({
        settledCount: Number(rec.settledCount),
        delinquentCount: Number(rec.delinquentCount),
        settledDrops: rec.settledDrops.toString(),
        delinquentDrops: rec.delinquentDrops.toString(),
        lastOutcomeTimestamp: Number(rec.lastOutcomeTimestamp),
      });
      break;
    }
    case "watch":
      await watch(opts);
      break;
    default:
      console.error(
        "usage: quittance <fund|create|pay|acknowledge|settle|mark|status|record|watch> [--flag value ...]"
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
