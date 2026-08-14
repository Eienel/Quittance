const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Issuance is unilateral - anyone may write an invoice naming anyone as the payer.
 * These tests cover the mechanism that stops that from becoming a way to manufacture
 * delinquencies against innocent accounts.
 */

const ATT_XRP_PAYMENT = ethers.encodeBytes32String("XRPPayment");
const ATT_XRP_NONEXISTENCE = ethers.encodeBytes32String("XRPPaymentNonexistence");
const SOURCE_TESTXRP = ethers.encodeBytes32String("testXRP");

const PAYEE = ethers.keccak256(ethers.toUtf8Bytes("rPayeeAccount"));
const PAYER = ethers.keccak256(ethers.toUtf8Bytes("rPayerAccount"));
const VICTIM = ethers.keccak256(ethers.toUtf8Bytes("rInnocentAccount"));

const TERMS = {
  amountDrops: 25_000_000n,
  minimalBlockNumber: 1_000_000n,
  deadlineBlockNumber: 1_000_500n,
  deadlineTimestamp: 1_800_000_000n,
};

const Status = { None: 0n, Open: 1n, Settled: 2n, Delinquent: 3n };

function paymentProof(overrides = {}) {
  const rb = {
    blockNumber: 1_000_400n,
    blockTimestamp: TERMS.deadlineTimestamp - 100n,
    sourceAddress: "rPayerAccount",
    sourceAddressHash: PAYER,
    receivingAddressHash: PAYEE,
    intendedReceivingAddressHash: PAYEE,
    spentAmount: 1n,
    intendedSpentAmount: 1n,
    receivedAmount: 1n, // one drop is enough to admit the debt
    intendedReceivedAmount: 1n,
    hasMemoData: false,
    firstMemoData: "0x",
    hasDestinationTag: true,
    destinationTag: 1n,
    status: 0n,
    ...overrides,
  };
  return {
    merkleProof: [],
    data: {
      attestationType: ATT_XRP_PAYMENT,
      sourceId: SOURCE_TESTXRP,
      votingRound: 12345n,
      lowestUsedTimestamp: rb.blockTimestamp,
      requestBody: {
        transactionId: ethers.keccak256(ethers.toUtf8Bytes("tx")),
        proofOwner: ethers.ZeroAddress,
      },
      responseBody: rb,
    },
  };
}

function nonexistenceProof(requestOverrides = {}) {
  return {
    merkleProof: [],
    data: {
      attestationType: ATT_XRP_NONEXISTENCE,
      sourceId: SOURCE_TESTXRP,
      votingRound: 12346n,
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
        ...requestOverrides,
      },
      responseBody: {
        minimalBlockTimestamp: TERMS.deadlineTimestamp - 1000n,
        firstOverflowBlockNumber: TERMS.deadlineBlockNumber + 3n,
        firstOverflowBlockTimestamp: TERMS.deadlineTimestamp + 5n,
      },
    },
  };
}

describe("acknowledgement", function () {
  let registry, mock;

  async function createInvoice(payerHash = PAYER) {
    await (
      await registry.createInvoice(
        PAYEE,
        payerHash,
        TERMS.amountDrops,
        TERMS.minimalBlockNumber,
        TERMS.deadlineBlockNumber,
        TERMS.deadlineTimestamp,
        ""
      )
    ).wait();
    return registry.invoiceCount();
  }

  beforeEach(async function () {
    mock = await (await ethers.getContractFactory("MockFdcVerification")).deploy();
    registry = await (
      await ethers.getContractFactory("InvoiceRegistry")
    ).deploy(await mock.getAddress(), SOURCE_TESTXRP);
  });

  // The whole point of the mechanism.
  describe("the fabricated-debt attack", function () {
    it("cannot mark an innocent account for a debt it never admitted", async function () {
      await createInvoice(VICTIM); // anyone may name anyone

      // The nonexistence proof is entirely truthful - nobody paid.
      await expect(registry.markDelinquent(1, nonexistenceProof()))
        .to.emit(registry, "InvoiceMarkedDelinquent")
        .withArgs(
          1n,
          1n,
          VICTIM,
          TERMS.amountDrops,
          TERMS.deadlineBlockNumber + 3n,
          TERMS.deadlineTimestamp + 5n,
          false // …but it does not reach the victim's record
        );

      expect((await registry.getInvoice(1)).status).to.equal(Status.Delinquent);

      const rec = await registry.record(VICTIM);
      expect(rec.delinquentCount).to.equal(0n);
      expect(rec.delinquentDrops).to.equal(0n);
      expect(rec.lastOutcomeTimestamp).to.equal(0n);
    });

    it("an issuer cannot acknowledge on the payer's behalf", async function () {
      await createInvoice(VICTIM);
      // Only a payment *from* the named account admits the debt. The issuer controls the
      // payee account, not the payer's.
      await expect(registry.acknowledge(1, paymentProof({ sourceAddressHash: PAYEE })))
        .to.be.revertedWithCustomError(registry, "ProofMismatch")
        .withArgs("payer");
    });

    it("counts the mark once the debtor has admitted the debt", async function () {
      await createInvoice();
      await registry.acknowledge(1, paymentProof());

      await expect(registry.markDelinquent(1, nonexistenceProof()))
        .to.emit(registry, "InvoiceMarkedDelinquent")
        .withArgs(
          1n,
          1n,
          PAYER,
          TERMS.amountDrops,
          TERMS.deadlineBlockNumber + 3n,
          TERMS.deadlineTimestamp + 5n,
          true
        );

      const rec = await registry.record(PAYER);
      expect(rec.delinquentCount).to.equal(1n);
      expect(rec.delinquentDrops).to.equal(TERMS.amountDrops);
    });
  });

  describe("acknowledge()", function () {
    beforeEach(async function () {
      await createInvoice();
    });

    it("records consent and emits the admitted amount", async function () {
      await expect(registry.acknowledge(1, paymentProof()))
        .to.emit(registry, "InvoiceAcknowledged")
        .withArgs(1n, 1n, PAYER, 1n, 1_000_400n);
      expect((await registry.getInvoice(1)).acknowledged).to.equal(true);
    });

    it("leaves the invoice open - consent is not payment", async function () {
      await registry.acknowledge(1, paymentProof());
      expect((await registry.getInvoice(1)).status).to.equal(Status.Open);
    });

    it("cannot be repeated", async function () {
      await registry.acknowledge(1, paymentProof());
      await expect(registry.acknowledge(1, paymentProof()))
        .to.be.revertedWithCustomError(registry, "AlreadyAcknowledged")
        .withArgs(1n);
    });

    it("requires the payment to carry this invoice's destination tag", async function () {
      await expect(registry.acknowledge(1, paymentProof({ destinationTag: 7n })))
        .to.be.revertedWithCustomError(registry, "ProofMismatch")
        .withArgs("destinationTag");
      await expect(
        registry.acknowledge(1, paymentProof({ hasDestinationTag: false, destinationTag: 0n }))
      )
        .to.be.revertedWithCustomError(registry, "ProofMismatch")
        .withArgs("destinationTag");
    });

    it("requires the payment to have reached the payee", async function () {
      await expect(registry.acknowledge(1, paymentProof({ receivingAddressHash: VICTIM })))
        .to.be.revertedWithCustomError(registry, "ProofMismatch")
        .withArgs("payee");
    });

    it("requires a non-zero amount", async function () {
      await expect(registry.acknowledge(1, paymentProof({ receivedAmount: 0n })))
        .to.be.revertedWithCustomError(registry, "ProofMismatch")
        .withArgs("amount");
    });

    // Otherwise an unrelated older payment could be replayed as consent to a later invoice.
    it("rejects a payment predating the invoice's window", async function () {
      await expect(
        registry.acknowledge(1, paymentProof({ blockNumber: TERMS.minimalBlockNumber - 1n }))
      )
        .to.be.revertedWithCustomError(registry, "ProofMismatch")
        .withArgs("minimalBlockNumber");
    });

    it("rejects a failed XRPL transaction", async function () {
      await expect(registry.acknowledge(1, paymentProof({ status: 2n })))
        .to.be.revertedWithCustomError(registry, "PaymentFailed")
        .withArgs(2n);
    });

    it("rejects a proof the FDC does not verify", async function () {
      await mock.setAccept(false);
      await expect(registry.acknowledge(1, paymentProof())).to.be.revertedWithCustomError(
        registry,
        "InvalidProof"
      );
    });

    it("cannot acknowledge a decided invoice", async function () {
      await registry.settle(1, paymentProof({ receivedAmount: TERMS.amountDrops }));
      await expect(registry.acknowledge(1, paymentProof()))
        .to.be.revertedWithCustomError(registry, "InvoiceNotOpen")
        .withArgs(1n, Status.Settled);
    });

    it("has no meaning for a bearer invoice", async function () {
      await createInvoice(ethers.ZeroHash); // invoice 2, tag 2
      await expect(registry.acknowledge(2, paymentProof({ destinationTag: 2n })))
        .to.be.revertedWithCustomError(registry, "NotAcknowledgeable")
        .withArgs("bearer invoice");
    });
  });

  describe("paying implies admitting", function () {
    it("settling marks the invoice acknowledged without a separate step", async function () {
      await createInvoice();
      await registry.settle(1, paymentProof({ receivedAmount: TERMS.amountDrops }));
      expect((await registry.getInvoice(1)).acknowledged).to.equal(true);
    });

    it("credits a settlement regardless of prior acknowledgement", async function () {
      await createInvoice();
      await registry.settle(1, paymentProof({ receivedAmount: TERMS.amountDrops }));
      expect((await registry.record(PAYER)).settledCount).to.equal(1n);
    });
  });
});
