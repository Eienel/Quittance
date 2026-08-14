/**
 * The XRPL half: the payer's side of a Plime invoice is just an ordinary
 * XRP payment carrying the invoice's destination tag.
 */
const { ethers } = require("ethers");
const xrpl = require("xrpl");
const cfg = require("./config");

/** FDC "standard address hash": keccak256 of the classic address string. */
function addressHash(classicAddress) {
  return ethers.keccak256(ethers.toUtf8Bytes(classicAddress));
}

/** Create and fund a fresh testnet account via the public faucet. */
async function fundNewAccount() {
  const res = await fetch(cfg.xrplFaucet, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`faucet: ${res.status}`);
  const body = await res.json();
  return {
    address: body.account.classicAddress ?? body.account.address,
    seed: body.seed,
  };
}

/**
 * Runs `fn` against the first XRPL endpoint that both connects and is in sync.
 *
 * A node that is up but still catching up answers `notSynced`, which is a
 * failure for our purposes - fail over rather than surfacing it as a dead end.
 */
async function withClient(fn) {
  const failures = [];

  for (const url of cfg.xrplWssList) {
    const client = new xrpl.Client(url, { connectionTimeout: 10_000 });
    try {
      await client.connect();
      return await fn(client);
    } catch (err) {
      failures.push(`${url}: ${err.message ?? err}`);
    } finally {
      if (client.isConnected()) await client.disconnect();
    }
  }

  throw new Error(`no usable XRPL endpoint - ${failures.join("; ")}`);
}

/**
 * Pay an invoice: send `amountDrops` to `destination` with `destinationTag`.
 * Returns the transaction hash (uppercase hex, as the verifier expects) and
 * the ledger index it validated in.
 */
async function payInvoice({ seed, destination, destinationTag, amountDrops }) {
  const wallet = xrpl.Wallet.fromSeed(seed ?? cfg.xrplSeed);
  return withClient(async (client) => {
    const tx = await client.submitAndWait(
      {
        TransactionType: "Payment",
        Account: wallet.classicAddress,
        Destination: destination,
        DestinationTag: Number(destinationTag),
        Amount: String(amountDrops),
      },
      { autofill: true, wallet }
    );
    const result = tx.result.meta.TransactionResult;
    if (result !== "tesSUCCESS") throw new Error(`XRPL payment failed: ${result}`);
    return {
      hash: tx.result.hash,
      ledgerIndex: tx.result.ledger_index,
      from: wallet.classicAddress,
    };
  });
}

/** Current validated ledger index and close time (as UNIX seconds). */
async function ledgerNow() {
  return withClient(async (client) => {
    const res = await client.request({ command: "ledger", ledger_index: "validated" });
    const l = res.result.ledger;
    return {
      ledgerIndex: Number(res.result.ledger_index ?? l.ledger_index),
      // XRPL close times count from the Ripple epoch (2000-01-01T00:00:00Z).
      closeTimeUnix: Number(l.close_time) + 946_684_800,
    };
  });
}

module.exports = { addressHash, fundNewAccount, payInvoice, ledgerNow };
