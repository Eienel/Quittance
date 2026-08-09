const { expect } = require("chai");
const { ethers, network } = require("hardhat");

/**
 * The bond is what turns a proof of non-payment from a statement into a consequence.
 * These tests cover where the money ends up on each outcome, and the ways a hostile
 * party might try to trap it.
 */

const ATT_XRP_PAYMENT = ethers.encodeBytes32String("XRPPayment");
const ATT_XRP_NONEXISTENCE = ethers.encodeBytes32String("XRPPaymentNonexistence");
const SOURCE_TESTXRP = ethers.encodeBytes32String("testXRP");

const PAYEE = ethers.keccak256(ethers.toUtf8Bytes("rPayeeAccount"));
const PAYER = ethers.keccak256(ethers.toUtf8Bytes("rPayerAccount"));

const TERMS = {
  amountDrops: 25_000_000n,
  minimalBlockNumber: 1_000_000n,
  deadlineBlockNumber: 1_000_500n,
  deadlineTimestamp: 1_800_000_000n,
};

const BOND = ethers.parseEther("3");
const Status = { Open: 1n, Settled: 2n, Delinquent: 3n };

function paymentProof(overrides = {}) {
  const rb = {
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
    ...overrides,
  };
  return {
    merkleProof: [],
    data: {
      attestationType: ATT_XRP_PAYMENT,
      sourceId: SOURCE_TESTXRP,
      votingRound: 1n,
      lowestUsedTimestamp: rb.blockTimestamp,
      requestBody: {
        transactionId: ethers.keccak256(ethers.toUtf8Bytes("tx")),
        proofOwner: ethers.ZeroAddress,
      },
      responseBody: rb,
    },
  };
}

const nonexistenceProof = (destinationTag = 1n) => ({
  merkleProof: [],
  data: {
    attestationType: ATT_XRP_NONEXISTENCE,
    sourceId: SOURCE_TESTXRP,
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
      destinationTag,
      proofOwner: ethers.ZeroAddress,
    },
    responseBody: {
      minimalBlockTimestamp: TERMS.deadlineTimestamp - 1000n,
      firstOverflowBlockNumber: TERMS.deadlineBlockNumber + 3n,
      firstOverflowBlockTimestamp: TERMS.deadlineTimestamp + 5n,
    },
  },
});

/** Advance to at least `target`, never backwards — the chain persists across tests. */
async function warpTo(target) {
  const latest = await ethers.provider.getBlock("latest");
  const next = Math.max(Number(target), latest.timestamp + 1);
  await network.provider.send("evm_setNextBlockTimestamp", [next]);
}

const RECLAIMABLE_AT = TERMS.deadlineTimestamp + 30n * 24n * 3600n;

describe("bond escrow", function () {
  let registry, mock, issuer, debtor, guarantor;

  async function createInvoice() {
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
    return registry.invoiceCount();
  }

  beforeEach(async function () {
    [issuer, debtor, guarantor] = await ethers.getSigners();
    mock = await (await ethers.getContractFactory("MockFdcVerification")).deploy();
    registry = await (
      await ethers.getContractFactory("InvoiceRegistry")
    ).deploy(await mock.getAddress(), SOURCE_TESTXRP);
    await createInvoice();
  });

  describe("posting", function () {
    it("locks value and records who posted it", async function () {
      await expect(registry.connect(debtor).postBond(1, { value: BOND }))
        .to.emit(registry, "BondPosted")
        .withArgs(1n, debtor.address, BOND, BOND);

      const inv = await registry.getInvoice(1);
      expect(inv.bondAmount).to.equal(BOND);
      expect(inv.bondPoster).to.equal(debtor.address);
      expect(await ethers.provider.getBalance(await registry.getAddress())).to.equal(BOND);
    });

    it("lets the same poster top up", async function () {
      await registry.connect(debtor).postBond(1, { value: BOND });
      await expect(registry.connect(debtor).postBond(1, { value: BOND }))
        .to.emit(registry, "BondPosted")
        .withArgs(1n, debtor.address, BOND, BOND * 2n);
      expect((await registry.getInvoice(1)).bondAmount).to.equal(BOND * 2n);
    });

    // Splitting a bond between parties would make refunds ambiguous.
    it("refuses a second poster", async function () {
      await registry.connect(debtor).postBond(1, { value: BOND });
      await expect(registry.connect(guarantor).postBond(1, { value: BOND }))
        .to.be.revertedWithCustomError(registry, "BondPostedByAnother")
        .withArgs(1n, debtor.address);
    });

    it("rejects an empty bond", async function () {
      await expect(registry.connect(debtor).postBond(1, { value: 0 })).to.be.revertedWithCustomError(
        registry,
        "ZeroBond"
      );
    });

    it("cannot bond a decided invoice", async function () {
      await registry.settle(1, paymentProof());
      await expect(
        registry.connect(debtor).postBond(1, { value: BOND })
      ).to.be.revertedWithCustomError(registry, "InvoiceNotOpen");
    });

    it("allows a third party to guarantee someone else's obligation", async function () {
      await registry.connect(guarantor).postBond(1, { value: BOND });
      expect((await registry.getInvoice(1)).bondPoster).to.equal(guarantor.address);
    });
  });

  describe("resolution", function () {
    beforeEach(async function () {
      await registry.connect(debtor).postBond(1, { value: BOND });
    });

    it("returns the bond to its poster when the obligation is met", async function () {
      await expect(registry.settle(1, paymentProof()))
        .to.emit(registry, "BondResolved")
        .withArgs(1n, debtor.address, BOND, false);

      expect(await registry.withdrawable(debtor.address)).to.equal(BOND);
      expect(await registry.withdrawable(issuer.address)).to.equal(0n);
      expect((await registry.getInvoice(1)).bondAmount).to.equal(0n);
    });

    // The whole point: the same attestation that records the mark moves the money.
    it("hands the bond to the creditor when the obligation is broken", async function () {
      await expect(registry.markDelinquent(1, nonexistenceProof()))
        .to.emit(registry, "BondResolved")
        .withArgs(1n, issuer.address, BOND, true);

      expect(await registry.withdrawable(issuer.address)).to.equal(BOND);
      expect(await registry.withdrawable(debtor.address)).to.equal(0n);
    });

    it("resolves at most once", async function () {
      await registry.markDelinquent(1, nonexistenceProof());
      expect(await registry.withdrawable(issuer.address)).to.equal(BOND);
      await expect(registry.settle(1, paymentProof())).to.be.revertedWithCustomError(
        registry,
        "InvoiceNotOpen"
      );
      expect(await registry.withdrawable(issuer.address)).to.equal(BOND);
    });

    it("leaves outcomes working when no bond was posted", async function () {
      await createInvoice(); // invoice 2, unbonded
      await expect(registry.markDelinquent(2, nonexistenceProof(2n))).to.not.be.reverted;
      expect(await registry.withdrawable(issuer.address)).to.equal(0n);
    });
  });

  describe("withdrawal", function () {
    it("pays out and cannot be drained twice", async function () {
      await registry.connect(debtor).postBond(1, { value: BOND });
      await registry.markDelinquent(1, nonexistenceProof());

      const before = await ethers.provider.getBalance(issuer.address);
      const receipt = await (await registry.withdraw()).wait();
      const gas = receipt.gasUsed * receipt.gasPrice;
      expect(await ethers.provider.getBalance(issuer.address)).to.equal(before + BOND - gas);

      expect(await registry.withdrawable(issuer.address)).to.equal(0n);
      await expect(registry.withdraw()).to.be.revertedWithCustomError(
        registry,
        "NothingToWithdraw"
      );
    });

    it("rejects a withdrawal by someone owed nothing", async function () {
      await expect(registry.connect(guarantor).withdraw()).to.be.revertedWithCustomError(
        registry,
        "NothingToWithdraw"
      );
    });
  });

  describe("reclaiming an unresolved bond", function () {
    beforeEach(async function () {
      await registry.connect(debtor).postBond(1, { value: BOND });
    });

    it("refuses before the grace period expires", async function () {
      await expect(registry.connect(debtor).reclaimBond(1))
        .to.be.revertedWithCustomError(registry, "ReclaimTooEarly")
        .withArgs(RECLAIMABLE_AT);
    });

    it("returns the bond once the outcome has gone unproved for long enough", async function () {
      await warpTo(RECLAIMABLE_AT + 1n);
      await expect(registry.connect(debtor).reclaimBond(1))
        .to.emit(registry, "BondReclaimed")
        .withArgs(1n, debtor.address, BOND);
      expect(await registry.withdrawable(debtor.address)).to.equal(BOND);
    });

    it("only the poster may reclaim", async function () {
      await warpTo(RECLAIMABLE_AT + 1n);
      await expect(registry.connect(guarantor).reclaimBond(1))
        .to.be.revertedWithCustomError(registry, "BondPostedByAnother")
        .withArgs(1n, debtor.address);
    });

    it("cannot reclaim after an outcome has already resolved the bond", async function () {
      await registry.markDelinquent(1, nonexistenceProof());
      await warpTo(RECLAIMABLE_AT + 1n);
      await expect(registry.connect(debtor).reclaimBond(1)).to.be.revertedWithCustomError(
        registry,
        "InvoiceNotOpen"
      );
    });
  });

  /**
   * An outcome must never be blockable. If proceeds were pushed rather than pulled, a
   * creditor whose address rejects payment could make their own invoice unsettleable.
   */
  describe("a recipient that rejects payment cannot block an outcome", function () {
    it("settles even when the bond poster refuses transfers", async function () {
      const rejecter = await (await ethers.getContractFactory("RejectingRecipient")).deploy();
      await rejecter.postBond(await registry.getAddress(), 1, { value: BOND });

      await expect(registry.settle(1, paymentProof())).to.not.be.reverted;
      expect((await registry.getInvoice(1)).status).to.equal(Status.Settled);
      // The credit stands; only their own withdrawal fails, which is their problem.
      expect(await registry.withdrawable(await rejecter.getAddress())).to.equal(BOND);
      await expect(rejecter.withdraw(await registry.getAddress())).to.be.reverted;
    });
  });
});
