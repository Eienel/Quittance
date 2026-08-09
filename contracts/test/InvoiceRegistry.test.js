const { expect } = require("chai");
const { ethers } = require("hardhat");

// Attestation type / source ids as the FDC encodes them: right-padded utf8.
const ATT_XRP_PAYMENT = ethers.encodeBytes32String("XRPPayment");
const ATT_XRP_NONEXISTENCE = ethers.encodeBytes32String("XRPPaymentNonexistence");
const SOURCE_TESTXRP = ethers.encodeBytes32String("testXRP");

const PAYEE = ethers.keccak256(ethers.toUtf8Bytes("rPayeeAccount"));
const PAYER = ethers.keccak256(ethers.toUtf8Bytes("rPayerAccount"));
const STRANGER = ethers.keccak256(ethers.toUtf8Bytes("rSomeoneElse"));

const TERMS = {
  amountDrops: 25_000_000n, // 25 XRP
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
    spentAmount: TERMS.amountDrops + 12n,
    intendedSpentAmount: TERMS.amountDrops + 12n,
    receivedAmount: TERMS.amountDrops,
    intendedReceivedAmount: TERMS.amountDrops,
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

function nonexistenceProof(requestOverrides = {}, responseOverrides = {}) {
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
        ...responseOverrides,
      },
    },
  };
}

describe("InvoiceRegistry", function () {
  let registry, mock, issuer;

  async function createInvoice(payerHash = PAYER) {
    const tx = await registry.createInvoice(
      PAYEE,
      payerHash,
      TERMS.amountDrops,
      TERMS.minimalBlockNumber,
      TERMS.deadlineBlockNumber,
      TERMS.deadlineTimestamp,
      "ipfs://invoice"
    );
    await tx.wait();
    return registry.invoiceCount();
  }

  beforeEach(async function () {
    [issuer] = await ethers.getSigners();
    mock = await (await ethers.getContractFactory("MockFdcVerification")).deploy();
    registry = await (
      await ethers.getContractFactory("InvoiceRegistry")
    ).deploy(await mock.getAddress(), SOURCE_TESTXRP);
  });

  describe("issuance", function () {
    it("issues a unique destination tag per invoice and indexes it", async function () {
      await createInvoice();
      await createInvoice();

      expect(await registry.invoiceCount()).to.equal(2n);
      expect(await registry.invoiceIdByTag(1)).to.equal(1n);
      expect(await registry.invoiceIdByTag(2)).to.equal(2n);

      const second = await registry.getInvoiceByTag(2);
      expect(second.destinationTag).to.equal(2n);
      expect(second.status).to.equal(Status.Open);
      expect(second.issuer).to.equal(issuer.address);
    });

    it("emits the full terms so the attester can rebuild the request off-chain", async function () {
      await expect(
        registry.createInvoice(
          PAYEE,
          PAYER,
          TERMS.amountDrops,
          TERMS.minimalBlockNumber,
          TERMS.deadlineBlockNumber,
          TERMS.deadlineTimestamp,
          "ipfs://invoice"
        )
      )
        .to.emit(registry, "InvoiceCreated")
        .withArgs(
          1n,
          1n,
          issuer.address,
          PAYEE,
          PAYER,
          TERMS.amountDrops,
          TERMS.minimalBlockNumber,
          TERMS.deadlineBlockNumber,
          TERMS.deadlineTimestamp,
          "ipfs://invoice"
        );
    });

    it("rejects terms that could never be attested", async function () {
      const call = (...args) => registry.createInvoice(...args, "");
      await expect(
        call(ethers.ZeroHash, PAYER, 1n, 1n, 2n, 3n)
      ).to.be.revertedWithCustomError(registry, "InvalidTerms");
      await expect(call(PAYEE, PAYER, 0n, 1n, 2n, 3n)).to.be.revertedWithCustomError(
        registry,
        "InvalidTerms"
      );
      // deadline block before the start of the search range
      await expect(call(PAYEE, PAYER, 1n, 100n, 99n, 3n)).to.be.revertedWithCustomError(
        registry,
        "InvalidTerms"
      );
      await expect(call(PAYEE, PAYER, 1n, 1n, 2n, 0n)).to.be.revertedWithCustomError(
        registry,
        "InvalidTerms"
      );
    });
  });

  describe("settle", function () {
    beforeEach(async function () {
      await createInvoice();
    });

    it("discharges the invoice and credits the payer's record", async function () {
      await expect(registry.settle(1, paymentProof()))
        .to.emit(registry, "InvoiceSettled")
        .withArgs(1n, 1n, PAYER, TERMS.amountDrops, 1_000_400n, TERMS.deadlineTimestamp - 100n);

      const inv = await registry.getInvoice(1);
      expect(inv.status).to.equal(Status.Settled);
      expect(inv.settledByAddressHash).to.equal(PAYER);
      expect(inv.outcomeTimestamp).to.equal(TERMS.deadlineTimestamp - 100n);

      const rec = await registry.record(PAYER);
      expect(rec.settledCount).to.equal(1n);
      expect(rec.delinquentCount).to.equal(0n);
      expect(rec.settledDrops).to.equal(TERMS.amountDrops);
      expect(rec.lastOutcomeTimestamp).to.equal(TERMS.deadlineTimestamp - 100n);
    });

    it("accepts an overpayment", async function () {
      await registry.settle(1, paymentProof({ receivedAmount: TERMS.amountDrops * 2n }));
      expect((await registry.getInvoice(1)).status).to.equal(Status.Settled);
    });

    it("rejects an underpayment", async function () {
      await expect(
        registry.settle(1, paymentProof({ receivedAmount: TERMS.amountDrops - 1n }))
      )
        .to.be.revertedWithCustomError(registry, "ProofMismatch")
        .withArgs("amount");
    });

    it("rejects a payment carrying another invoice's destination tag", async function () {
      await expect(registry.settle(1, paymentProof({ destinationTag: 2n })))
        .to.be.revertedWithCustomError(registry, "ProofMismatch")
        .withArgs("destinationTag");
    });

    it("rejects a payment with no destination tag at all", async function () {
      await expect(
        registry.settle(1, paymentProof({ hasDestinationTag: false, destinationTag: 0n }))
      )
        .to.be.revertedWithCustomError(registry, "ProofMismatch")
        .withArgs("destinationTag");
    });

    it("rejects a payment to the wrong XRPL account", async function () {
      await expect(registry.settle(1, paymentProof({ receivingAddressHash: STRANGER })))
        .to.be.revertedWithCustomError(registry, "ProofMismatch")
        .withArgs("payee");
    });

    it("rejects a payment from someone other than the named debtor", async function () {
      await expect(registry.settle(1, paymentProof({ sourceAddressHash: STRANGER })))
        .to.be.revertedWithCustomError(registry, "ProofMismatch")
        .withArgs("payer");
    });

    it("lets anyone settle a bearer invoice", async function () {
      await createInvoice(ethers.ZeroHash); // invoice 2, tag 2
      await registry.settle(
        2,
        paymentProof({ sourceAddressHash: STRANGER, destinationTag: 2n })
      );
      const rec = await registry.record(STRANGER);
      expect(rec.settledCount).to.equal(1n);
    });

    it("rejects a failed XRPL transaction", async function () {
      await expect(registry.settle(1, paymentProof({ status: 1n })))
        .to.be.revertedWithCustomError(registry, "PaymentFailed")
        .withArgs(1n);
      await expect(registry.settle(1, paymentProof({ status: 2n })))
        .to.be.revertedWithCustomError(registry, "PaymentFailed")
        .withArgs(2n);
    });

    it("rejects a payment made after the deadline", async function () {
      const late = TERMS.deadlineTimestamp + 1n;
      await expect(registry.settle(1, paymentProof({ blockTimestamp: late })))
        .to.be.revertedWithCustomError(registry, "PaidAfterDeadline")
        .withArgs(late, TERMS.deadlineTimestamp);
    });

    it("accepts a payment landing exactly on the deadline", async function () {
      await registry.settle(1, paymentProof({ blockTimestamp: TERMS.deadlineTimestamp }));
      expect((await registry.getInvoice(1)).status).to.equal(Status.Settled);
    });

    it("rejects a proof the FDC does not verify", async function () {
      await mock.setAccept(false);
      await expect(registry.settle(1, paymentProof())).to.be.revertedWithCustomError(
        registry,
        "InvalidProof"
      );
    });
  });

  describe("markDelinquent", function () {
    beforeEach(async function () {
      await createInvoice();
    });

    beforeEach(async function () {
      // The debtor admits the debt: a one-drop payment carrying this invoice's tag.
      await registry.acknowledge(1, paymentProof({ receivedAmount: 1n }));
    });

    it("marks the invoice and the debtor permanently", async function () {
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

      const inv = await registry.getInvoice(1);
      expect(inv.status).to.equal(Status.Delinquent);
      expect(inv.settledByAddressHash).to.equal(ethers.ZeroHash);

      const rec = await registry.record(PAYER);
      expect(rec.delinquentCount).to.equal(1n);
      expect(rec.delinquentDrops).to.equal(TERMS.amountDrops);
      expect(rec.lastOutcomeTimestamp).to.equal(TERMS.deadlineTimestamp + 5n);
    });

    // The cherry-picked-window attack: a valid nonexistence proof over terms that are not
    // this invoice's terms proves nothing about this invoice.
    const tamperings = [
      ["payee", { destinationAddressHash: STRANGER }],
      ["amount", { amount: TERMS.amountDrops * 10n }],
      ["minimalBlockNumber", { minimalBlockNumber: TERMS.deadlineBlockNumber - 1n }],
      ["deadlineBlockNumber", { deadlineBlockNumber: TERMS.minimalBlockNumber + 1n }],
      ["deadlineTimestamp", { deadlineTimestamp: TERMS.deadlineTimestamp - 3600n }],
      ["destinationTag", { destinationTag: 999n }],
      ["destinationTag", { checkDestinationTag: false }],
      ["checkFirstMemoData", { checkFirstMemoData: true, firstMemoDataHash: PAYER }],
    ];

    for (const [field, override] of tamperings) {
      const label = Object.keys(override).join("+");
      it(`rejects a nonexistence proof whose ${label} does not match the invoice`, async function () {
        await expect(registry.markDelinquent(1, nonexistenceProof(override)))
          .to.be.revertedWithCustomError(registry, "ProofMismatch")
          .withArgs(field);
      });
    }

    it("marks a bearer invoice without moving anyone's record", async function () {
      await createInvoice(ethers.ZeroHash); // invoice 2, tag 2
      await expect(registry.markDelinquent(2, nonexistenceProof({ destinationTag: 2n })))
        .to.emit(registry, "InvoiceMarkedDelinquent")
        .withArgs(
          2n,
          2n,
          ethers.ZeroHash,
          TERMS.amountDrops,
          TERMS.deadlineBlockNumber + 3n,
          TERMS.deadlineTimestamp + 5n,
          false
        );
      expect((await registry.record(ethers.ZeroHash)).delinquentCount).to.equal(0n);
    });

    it("rejects a proof the FDC does not verify", async function () {
      await mock.setAccept(false);
      await expect(
        registry.markDelinquent(1, nonexistenceProof())
      ).to.be.revertedWithCustomError(registry, "InvalidProof");
    });
  });

  describe("one outcome, permanently", function () {
    beforeEach(async function () {
      await createInvoice();
    });

    it("cannot mark an invoice that was settled", async function () {
      await registry.settle(1, paymentProof());
      await expect(registry.markDelinquent(1, nonexistenceProof()))
        .to.be.revertedWithCustomError(registry, "InvoiceNotOpen")
        .withArgs(1n, Status.Settled);
    });

    it("cannot settle an invoice that was marked", async function () {
      await registry.markDelinquent(1, nonexistenceProof());
      await expect(registry.settle(1, paymentProof()))
        .to.be.revertedWithCustomError(registry, "InvoiceNotOpen")
        .withArgs(1n, Status.Delinquent);
    });

    it("cannot settle twice, so a record cannot be inflated", async function () {
      await registry.settle(1, paymentProof());
      await expect(registry.settle(1, paymentProof())).to.be.revertedWithCustomError(
        registry,
        "InvoiceNotOpen"
      );
      expect((await registry.record(PAYER)).settledCount).to.equal(1n);
    });

    it("cannot mark twice", async function () {
      await registry.acknowledge(1, paymentProof({ receivedAmount: 1n }));
      await registry.markDelinquent(1, nonexistenceProof());
      await expect(
        registry.markDelinquent(1, nonexistenceProof())
      ).to.be.revertedWithCustomError(registry, "InvoiceNotOpen");
      expect((await registry.record(PAYER)).delinquentCount).to.equal(1n);
    });
  });

  describe("views", function () {
    it("rejects reads of invoices that do not exist", async function () {
      await expect(registry.getInvoice(42)).to.be.revertedWithCustomError(
        registry,
        "NoSuchInvoice"
      );
      await expect(registry.getInvoiceByTag(42)).to.be.revertedWithCustomError(
        registry,
        "NoSuchInvoice"
      );
      await expect(registry.isPastDeadline(42, 1n)).to.be.revertedWithCustomError(
        registry,
        "NoSuchInvoice"
      );
    });

    it("reports an empty record for an account with no history", async function () {
      const rec = await registry.record(STRANGER);
      expect(rec.settledCount).to.equal(0n);
      expect(rec.delinquentCount).to.equal(0n);
    });

    it("advises on deadline expiry using XRPL time", async function () {
      await createInvoice();
      expect(await registry.isPastDeadline(1, TERMS.deadlineTimestamp)).to.equal(false);
      expect(await registry.isPastDeadline(1, TERMS.deadlineTimestamp + 1n)).to.equal(true);
    });

    it("accumulates both outcomes against one account", async function () {
      await createInvoice(); // 1
      await createInvoice(); // 2
      await registry.settle(1, paymentProof());
      await registry.acknowledge(2, paymentProof({ receivedAmount: 1n, destinationTag: 2n }));
      await registry.markDelinquent(2, nonexistenceProof({ destinationTag: 2n }));

      const rec = await registry.record(PAYER);
      expect(rec.settledCount).to.equal(1n);
      expect(rec.delinquentCount).to.equal(1n);
      expect(rec.settledDrops).to.equal(TERMS.amountDrops);
      expect(rec.delinquentDrops).to.equal(TERMS.amountDrops);
    });
  });
});
