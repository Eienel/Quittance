const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * A genuine attestation is not automatically an attestation about *us*.
 *
 * The FDC confirms a request against whichever chain that request named, and the proof
 * carries that chain in `sourceId`. Verifying the Merkle proof shows the attestation is
 * real; only checking the origin shows it is about the ledger this registry serves.
 *
 * These tests pin the cross-chain substitution that would otherwise let anyone mark a
 * genuinely-paid invoice delinquent, damage the payer's record, and take the bond — using
 * a proof that is perfectly true about a different XRPL network.
 */

const ATT_XRP_PAYMENT = ethers.encodeBytes32String("XRPPayment");
const ATT_XRP_NONEXISTENCE = ethers.encodeBytes32String("XRPPaymentNonexistence");
const SOURCE_TESTXRP = ethers.encodeBytes32String("testXRP");
const SOURCE_XRP_MAINNET = ethers.encodeBytes32String("XRP");

const PAYEE = ethers.keccak256(ethers.toUtf8Bytes("rPayeeAccount"));
const PAYER = ethers.keccak256(ethers.toUtf8Bytes("rPayerAccount"));

const TERMS = {
  amountDrops: 25_000_000n,
  minimalBlockNumber: 1_000_000n,
  deadlineBlockNumber: 1_000_500n,
  deadlineTimestamp: 1_800_000_000n,
};

const Status = { Open: 1n, Settled: 2n, Delinquent: 3n };
const BOND = ethers.parseEther("2");

const paymentProof = ({ sourceId = SOURCE_TESTXRP, attestationType = ATT_XRP_PAYMENT } = {}) => ({
  merkleProof: [],
  data: {
    attestationType,
    sourceId,
    votingRound: 1n,
    lowestUsedTimestamp: TERMS.deadlineTimestamp - 100n,
    requestBody: {
      transactionId: ethers.keccak256(ethers.toUtf8Bytes("tx")),
      proofOwner: ethers.ZeroAddress,
    },
    responseBody: {
      blockNumber: 1_000_400n,
      blockTimestamp: TERMS.deadlineTimestamp - 100n,
      sourceAddress: "rPayerAccount",
      sourceAddressHash: PAYER,
      receivingAddressHash: PAYEE,
      intendedReceivingAddressHash: PAYEE,
      spentAmount: TERMS.amountDrops,
      intendedSpentAmount: TERMS.amountDrops,
      receivedAmount: TERMS.amountDrops,
      intendedReceivedAmount: TERMS.amountDrops,
      hasMemoData: false,
      firstMemoData: "0x",
      hasDestinationTag: true,
      destinationTag: 1n,
      status: 0n,
    },
  },
});

const nonexistenceProof = ({
  sourceId = SOURCE_TESTXRP,
  attestationType = ATT_XRP_NONEXISTENCE,
} = {}) => ({
  merkleProof: [],
  data: {
    attestationType,
    sourceId,
    votingRound: 2n,
    lowestUsedTimestamp: TERMS.deadlineTimestamp,
    requestBody: {
      minimalBlockNumber: TERMS.minimalBlockNumber,
      deadlineBlockNumber: TERMS.deadlineBlockNumber,
      deadlineTimestamp: TERMS.deadlineTimestamp,
      destinationAddressHash: PAYEE,
      amount: TERMS.amountDrops,
      checkFirstMemoData: false,
      firstMemoDataHash: ethers.ZeroHash,
      checkDestinationTag: true,
      destinationTag: 1n,
      proofOwner: ethers.ZeroAddress,
    },
    responseBody: {
      minimalBlockTimestamp: TERMS.deadlineTimestamp - 1000n,
      firstOverflowBlockNumber: TERMS.deadlineBlockNumber + 3n,
      firstOverflowBlockTimestamp: TERMS.deadlineTimestamp + 5n,
    },
  },
});

describe("proof origin", function () {
  let registry, mock, issuer, debtor;

  beforeEach(async function () {
    [issuer, debtor] = await ethers.getSigners();
    mock = await (await ethers.getContractFactory("MockFdcVerification")).deploy();
    registry = await (
      await ethers.getContractFactory("InvoiceRegistry")
    ).deploy(await mock.getAddress(), SOURCE_TESTXRP);

    await (
      await registry.createInvoice(
        PAYEE,
        PAYER,
        TERMS.amountDrops,
        TERMS.minimalBlockNumber,
        TERMS.deadlineBlockNumber,
        TERMS.deadlineTimestamp,
        ""
      )
    ).wait();
  });

  it("pins the source chain at deployment", async function () {
    expect(await registry.sourceId()).to.equal(SOURCE_TESTXRP);
  });

  it("refuses a registry with no source chain", async function () {
    const factory = await ethers.getContractFactory("InvoiceRegistry");
    await expect(factory.deploy(await mock.getAddress(), ethers.ZeroHash))
      .to.be.revertedWithCustomError(registry, "InvalidTerms")
      .withArgs("sourceId");
  });

  /**
   * The attack this exists to stop. Every request-body field matches the invoice; the
   * attestation is genuine and its statement is true. It is simply true about mainnet.
   */
  it("cannot mark a testnet invoice with a mainnet nonexistence proof", async function () {
    await registry.connect(debtor).postBond(1, { value: BOND });

    await expect(registry.markDelinquent(1, nonexistenceProof({ sourceId: SOURCE_XRP_MAINNET })))
      .to.be.revertedWithCustomError(registry, "WrongSourceChain")
      .withArgs(SOURCE_XRP_MAINNET, SOURCE_TESTXRP);

    // Nothing moved: the invoice is still open and the bond is still locked.
    const inv = await registry.getInvoice(1);
    expect(inv.status).to.equal(Status.Open);
    expect(inv.bondAmount).to.equal(BOND);
    expect(await registry.withdrawable(issuer.address)).to.equal(0n);
    expect((await registry.record(PAYER)).delinquentCount).to.equal(0n);
  });

  it("cannot settle with a payment proved on another chain", async function () {
    await expect(registry.settle(1, paymentProof({ sourceId: SOURCE_XRP_MAINNET })))
      .to.be.revertedWithCustomError(registry, "WrongSourceChain")
      .withArgs(SOURCE_XRP_MAINNET, SOURCE_TESTXRP);
  });

  it("cannot acknowledge with a payment proved on another chain", async function () {
    await expect(registry.acknowledge(1, paymentProof({ sourceId: SOURCE_XRP_MAINNET })))
      .to.be.revertedWithCustomError(registry, "WrongSourceChain")
      .withArgs(SOURCE_XRP_MAINNET, SOURCE_TESTXRP);
  });

  // Defence in depth: FdcVerification binds the type too, but a consumer that assumes so
  // and is wrong has no second line.
  it("rejects a proof whose attestation type is not the one being read", async function () {
    await expect(registry.settle(1, paymentProof({ attestationType: ATT_XRP_NONEXISTENCE })))
      .to.be.revertedWithCustomError(registry, "WrongAttestationType")
      .withArgs(ATT_XRP_NONEXISTENCE, ATT_XRP_PAYMENT);

    await expect(registry.markDelinquent(1, nonexistenceProof({ attestationType: ATT_XRP_PAYMENT })))
      .to.be.revertedWithCustomError(registry, "WrongAttestationType")
      .withArgs(ATT_XRP_PAYMENT, ATT_XRP_NONEXISTENCE);
  });

  it("still accepts proofs from the chain it serves", async function () {
    await expect(registry.settle(1, paymentProof())).to.not.be.reverted;
    expect((await registry.getInvoice(1)).status).to.equal(Status.Settled);
  });

  it("serves mainnet when deployed for mainnet", async function () {
    const mainnetRegistry = await (
      await ethers.getContractFactory("InvoiceRegistry")
    ).deploy(await mock.getAddress(), SOURCE_XRP_MAINNET);

    await (
      await mainnetRegistry.createInvoice(
        PAYEE,
        PAYER,
        TERMS.amountDrops,
        TERMS.minimalBlockNumber,
        TERMS.deadlineBlockNumber,
        TERMS.deadlineTimestamp,
        ""
      )
    ).wait();

    await expect(mainnetRegistry.settle(1, paymentProof({ sourceId: SOURCE_XRP_MAINNET })))
      .to.not.be.reverted;
    await expect(mainnetRegistry.settle(1, paymentProof())).to.be.revertedWithCustomError(
      mainnetRegistry,
      "InvoiceNotOpen"
    );
  });
});
