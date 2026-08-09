/**
 * InvoiceRegistry bindings and the two outcome pipelines.
 */
const path = require("path");
const { ethers } = require("ethers");
const cfg = require("./config");
const fdc = require("./fdc");

const ARTIFACT = require(path.join(
  __dirname,
  "..",
  "..",
  "..",
  "contracts",
  "artifacts",
  "src",
  "InvoiceRegistry.sol",
  "InvoiceRegistry.json"
));

function registry(runner = fdc.signer()) {
  if (!cfg.registryAddress) throw new Error("INVOICE_REGISTRY not set");
  return new ethers.Contract(cfg.registryAddress, ARTIFACT.abi, runner);
}

async function createInvoice({
  payeeAddressHash,
  payerAddressHash = ethers.ZeroHash,
  amountDrops,
  minimalBlockNumber,
  deadlineBlockNumber,
  deadlineTimestamp,
  metadataURI = "",
}) {
  const reg = registry();
  const tx = await reg.createInvoice(
    payeeAddressHash,
    payerAddressHash,
    amountDrops,
    minimalBlockNumber,
    deadlineBlockNumber,
    deadlineTimestamp,
    metadataURI
  );
  const receipt = await tx.wait();
  const created = receipt.logs
    .map((l) => {
      try {
        return reg.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((l) => l && l.name === "InvoiceCreated");
  return {
    invoiceId: created.args.invoiceId,
    destinationTag: created.args.destinationTag,
    txHash: receipt.hash,
  };
}

async function getInvoice(invoiceId) {
  return registry(fdc.provider()).getInvoice(invoiceId);
}

/**
 * Consent path: prove a payment from the debtor carrying the invoice's tag.
 * One drop is enough — it is the debtor's signature over the debt, not payment.
 */
async function acknowledge(invoiceId, xrplTxHash, log = console.error) {
  const encoded = await fdc.prepareXrpPaymentRequest(
    "0x" + xrplTxHash.replace(/^0x/i, "").toUpperCase(),
    log
  );
  const proof = await fdc.obtainProof(encoded, fdc.XRP_PAYMENT_RESPONSE, log);
  const tx = await registry().acknowledge(invoiceId, proof);
  const receipt = await tx.wait();
  log(`acknowledged invoice ${invoiceId} in ${receipt.hash}`);
  return receipt.hash;
}

/** Paid path: prove the XRPL transaction and settle the invoice. */
async function settleWithPayment(invoiceId, xrplTxHash, log = console.error) {
  const encoded = await fdc.prepareXrpPaymentRequest(
    "0x" + xrplTxHash.replace(/^0x/i, "").toUpperCase(),
    log
  );
  const proof = await fdc.obtainProof(encoded, fdc.XRP_PAYMENT_RESPONSE, log);
  const tx = await registry().settle(invoiceId, proof);
  const receipt = await tx.wait();
  log(`settled invoice ${invoiceId} in ${receipt.hash}`);
  return receipt.hash;
}

/** Unpaid path: prove the absence over the invoice's exact terms and mark it. */
async function markDelinquent(invoiceId, log = console.error) {
  const inv = await getInvoice(invoiceId);
  const encoded = await fdc.prepareNonexistenceRequest(inv);
  const proof = await fdc.obtainProof(encoded, fdc.XRP_NONEXISTENCE_RESPONSE, log);
  const tx = await registry().markDelinquent(invoiceId, proof);
  const receipt = await tx.wait();
  log(`marked invoice ${invoiceId} delinquent in ${receipt.hash}`);
  return receipt.hash;
}

module.exports = {
  registry,
  createInvoice,
  getInvoice,
  acknowledge,
  settleWithPayment,
  markDelinquent,
  ARTIFACT,
};
