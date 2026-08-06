// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IXRPPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPayment.sol";
import {IXRPPaymentNonexistence} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPaymentNonexistence.sol";
import {IXRPPaymentVerification} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPaymentVerification.sol";
import {IXRPPaymentNonexistenceVerification} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPaymentNonexistenceVerification.sol";

/**
 * @title InvoiceRegistry
 * @notice An invoice ends in exactly one of two cryptographic outcomes, and never both:
 *         a *quittance* (an FDC-proved XRPL payment discharging the debt) or a *mark*
 *         (an FDC-proved absence of that payment by the deadline). Both outcomes are
 *         permanent and both are proved against the same Flare Data Connector Merkle
 *         root, so neither party can assert one without the network having attested it.
 *
 *         Invoices are matched on the XRPL by destination tag: the registry issues a
 *         unique uint32 tag per invoice, which any wallet or exchange can attach to an
 *         ordinary XRP payment. No custody, no bridging, no counterparty software.
 */
contract InvoiceRegistry {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    enum Status {
        None,
        Open,
        Settled,
        Delinquent
    }

    struct Invoice {
        // --- identity ---
        address issuer;
        uint32 destinationTag;
        Status status;
        // --- payment terms, all of which the nonexistence proof must reproduce exactly ---
        bytes32 payeeAddressHash; // standard address hash of the XRPL account to be paid
        uint256 amountDrops; // 1 XRP = 1_000_000 drops
        uint64 minimalBlockNumber; // inclusive start of the XRPL search range
        uint64 deadlineBlockNumber; // last ledger index that still counts as on time
        uint64 deadlineTimestamp; // last close time that still counts as on time
        // --- the debtor this invoice is written against ---
        bytes32 payerAddressHash; // zero = bearer invoice, anyone may settle it
        /// @dev Whether the named debtor has admitted this debt. Anyone may *name* a payer,
        ///      so nothing accrues to that account's record until they say the debt is real.
        bool acknowledged;
        // --- outcome ---
        bytes32 settledByAddressHash; // who actually paid (Settled only)
        uint64 outcomeTimestamp; // XRPL close time of the payment, or of the overflow block
        string metadataURI;
    }

    /// @notice The permanent record accumulated against one XRPL account.
    /// @dev Only acknowledged invoices are counted here — see `markDelinquent`.
    struct PayerRecord {
        uint64 settledCount;
        uint64 delinquentCount;
        uint256 settledDrops;
        uint256 delinquentDrops;
        uint64 lastOutcomeTimestamp;
    }

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    uint256 public invoiceCount;
    mapping(uint256 => Invoice) private _invoices;

    /// @dev Destination tags are the XRPL-side primary key, so they must never repeat.
    mapping(uint32 => uint256) public invoiceIdByTag;
    uint32 private _nextTag = 1;

    mapping(bytes32 => PayerRecord) private _records;

    /// @dev Optional override of the FDC verification contract, for tests and for
    ///      networks where the registry lookup is not available. Zero means
    ///      "resolve through FlareContractRegistry", which is the production path.
    address public immutable fdcVerificationOverride;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event InvoiceCreated(
        uint256 indexed invoiceId,
        uint32 indexed destinationTag,
        address indexed issuer,
        bytes32 payeeAddressHash,
        bytes32 payerAddressHash,
        uint256 amountDrops,
        uint64 minimalBlockNumber,
        uint64 deadlineBlockNumber,
        uint64 deadlineTimestamp,
        string metadataURI
    );

    event InvoiceSettled(
        uint256 indexed invoiceId,
        uint32 indexed destinationTag,
        bytes32 indexed payerAddressHash,
        uint256 receivedDrops,
        uint64 xrplBlockNumber,
        uint64 xrplTimestamp
    );

    event InvoiceMarkedDelinquent(
        uint256 indexed invoiceId,
        uint32 indexed destinationTag,
        bytes32 indexed payerAddressHash,
        uint256 amountDrops,
        uint64 firstOverflowBlockNumber,
        uint64 firstOverflowBlockTimestamp,
        /// @dev False when the debt was never acknowledged, in which case the mark stands
        ///      against the invoice but not against the payer's record.
        bool countedAgainstPayer
    );

    event InvoiceAcknowledged(
        uint256 indexed invoiceId,
        uint32 indexed destinationTag,
        bytes32 indexed payerAddressHash,
        uint256 acknowledgedDrops,
        uint64 xrplBlockNumber
    );

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error NoSuchInvoice(uint256 invoiceId);
    error InvoiceNotOpen(uint256 invoiceId, Status status);
    error InvalidTerms(string what);
    error InvalidProof();
    error ProofMismatch(string field);
    error PaymentFailed(uint8 status);
    error PaidAfterDeadline(uint64 xrplTimestamp, uint64 deadlineTimestamp);
    error TagSpaceExhausted();
    error NotAcknowledgeable(string why);
    error AlreadyAcknowledged(uint256 invoiceId);

    constructor(address _fdcVerificationOverride) {
        fdcVerificationOverride = _fdcVerificationOverride;
    }

    // -------------------------------------------------------------------------
    // Issuance
    // -------------------------------------------------------------------------

    /**
     * @notice Issue an invoice and reserve a destination tag for it.
     * @param payeeAddressHash Standard address hash of the XRPL account to be paid.
     * @param payerAddressHash Standard address hash of the debtor, or zero for a bearer
     *        invoice that any XRPL account may settle. A non-zero value is what makes the
     *        outcome attributable: it is the key the payment record accrues under.
     * @param amountDrops Amount owed, in drops. A payment of at least this much settles it.
     * @param minimalBlockNumber Inclusive start of the XRPL ledger range in which payment counts.
     * @param deadlineBlockNumber Last ledger index that still counts as paid on time.
     * @param deadlineTimestamp Last XRPL close time that still counts as paid on time.
     * @param metadataURI Off-chain pointer to the human-readable invoice (may be empty).
     * @return invoiceId The registry id.
     * @return destinationTag The uint32 tag the payer must attach to their XRPL payment.
     */
    function createInvoice(
        bytes32 payeeAddressHash,
        bytes32 payerAddressHash,
        uint256 amountDrops,
        uint64 minimalBlockNumber,
        uint64 deadlineBlockNumber,
        uint64 deadlineTimestamp,
        string calldata metadataURI
    ) external returns (uint256 invoiceId, uint32 destinationTag) {
        if (payeeAddressHash == bytes32(0)) revert InvalidTerms("payeeAddressHash");
        if (amountDrops == 0) revert InvalidTerms("amountDrops");
        if (deadlineBlockNumber < minimalBlockNumber) revert InvalidTerms("deadlineBlockNumber");
        if (deadlineTimestamp == 0) revert InvalidTerms("deadlineTimestamp");

        destinationTag = _nextTag;
        // XRPL destination tags are uint32; running out means this registry deployment is
        // full rather than that the caller did anything wrong.
        if (destinationTag == type(uint32).max) revert TagSpaceExhausted();
        _nextTag = destinationTag + 1;

        invoiceId = ++invoiceCount;
        invoiceIdByTag[destinationTag] = invoiceId;

        _invoices[invoiceId] = Invoice({
            issuer: msg.sender,
            destinationTag: destinationTag,
            status: Status.Open,
            payeeAddressHash: payeeAddressHash,
            amountDrops: amountDrops,
            minimalBlockNumber: minimalBlockNumber,
            deadlineBlockNumber: deadlineBlockNumber,
            deadlineTimestamp: deadlineTimestamp,
            payerAddressHash: payerAddressHash,
            acknowledged: false,
            settledByAddressHash: bytes32(0),
            outcomeTimestamp: 0,
            metadataURI: metadataURI
        });

        emit InvoiceCreated(
            invoiceId,
            destinationTag,
            msg.sender,
            payeeAddressHash,
            payerAddressHash,
            amountDrops,
            minimalBlockNumber,
            deadlineBlockNumber,
            deadlineTimestamp,
            metadataURI
        );
    }

    // -------------------------------------------------------------------------
    // Consent
    // -------------------------------------------------------------------------

    /**
     * @notice Record that the named debtor admits this debt is real.
     *
     * @dev Issuance is unilateral: anyone may write an invoice naming anyone as the payer.
     *      A nonexistence proof over such an invoice is perfectly true and completely
     *      meaningless — it proves nobody paid a debt that was never owed. Left unguarded,
     *      that would let anyone manufacture delinquencies against any XRPL account, and a
     *      lender reading a record could not tell a real obligation from a fabricated one.
     *
     *      So the payer's own signature over the debt is what admits it into their record,
     *      and the XRPL itself carries that signature: any payment from the payer's account
     *      to the payee bearing this invoice's unique destination tag is an act only the
     *      key-holder could perform, against terms only this invoice defines. One drop is
     *      enough. Paying in full acknowledges implicitly, so an honest payer never does
     *      this separately.
     *
     *      Anyone may submit the proof — the attestation, not the sender, is the authority.
     */
    function acknowledge(uint256 invoiceId, IXRPPayment.Proof calldata proof) external {
        Invoice storage inv = _open(invoiceId);

        if (inv.payerAddressHash == bytes32(0)) revert NotAcknowledgeable("bearer invoice");
        if (inv.acknowledged) revert AlreadyAcknowledged(invoiceId);

        if (!_xrpPaymentVerification().verifyXRPPayment(proof)) revert InvalidProof();

        IXRPPayment.ResponseBody calldata rb = proof.data.responseBody;

        // A failed send still proves the payer signed it, but only a success proves they
        // meant it enough to part with the drops.
        if (rb.status != 0) revert PaymentFailed(rb.status);
        if (rb.sourceAddressHash != inv.payerAddressHash) revert ProofMismatch("payer");
        if (rb.receivingAddressHash != inv.payeeAddressHash) revert ProofMismatch("payee");
        if (!rb.hasDestinationTag || rb.destinationTag != inv.destinationTag) {
            revert ProofMismatch("destinationTag");
        }
        if (rb.receivedAmount <= 0) revert ProofMismatch("amount");
        // Confine it to this invoice's own window, so a payment predating the invoice
        // cannot be replayed as consent to it.
        if (rb.blockNumber < inv.minimalBlockNumber) revert ProofMismatch("minimalBlockNumber");

        inv.acknowledged = true;

        emit InvoiceAcknowledged(
            invoiceId,
            inv.destinationTag,
            inv.payerAddressHash,
            uint256(rb.receivedAmount),
            rb.blockNumber
        );
    }

    // -------------------------------------------------------------------------
    // Outcome: the quittance
    // -------------------------------------------------------------------------

    /**
     * @notice Discharge an invoice with an FDC-proved XRPL payment.
     * @dev The proof carries the whole transaction, so every term is checked against the
     *      invoice here rather than trusted from the caller. Anyone may submit it — the
     *      proof, not the sender, is the authority.
     */
    function settle(uint256 invoiceId, IXRPPayment.Proof calldata proof) external {
        Invoice storage inv = _open(invoiceId);

        if (!_xrpPaymentVerification().verifyXRPPayment(proof)) revert InvalidProof();

        IXRPPayment.ResponseBody calldata rb = proof.data.responseBody;

        // 0 = success, 1 = sender failure, 2 = receiver failure. Only a success moved funds.
        if (rb.status != 0) revert PaymentFailed(rb.status);
        if (rb.receivingAddressHash != inv.payeeAddressHash) revert ProofMismatch("payee");
        if (!rb.hasDestinationTag || rb.destinationTag != inv.destinationTag) {
            revert ProofMismatch("destinationTag");
        }
        if (rb.receivedAmount < 0 || uint256(rb.receivedAmount) < inv.amountDrops) {
            revert ProofMismatch("amount");
        }
        if (inv.payerAddressHash != bytes32(0) && rb.sourceAddressHash != inv.payerAddressHash) {
            revert ProofMismatch("payer");
        }
        // Late payment is still payment, but it is not a settlement of *this* invoice: the
        // matching nonexistence proof over the same range would also be valid, and only one
        // outcome may stand.
        if (rb.blockTimestamp > inv.deadlineTimestamp) {
            revert PaidAfterDeadline(rb.blockTimestamp, inv.deadlineTimestamp);
        }

        bytes32 payer = rb.sourceAddressHash;

        inv.status = Status.Settled;
        inv.settledByAddressHash = payer;
        inv.outcomeTimestamp = rb.blockTimestamp;
        // Paying a debt admits it. Nobody needs to acknowledge separately to be credited.
        inv.acknowledged = true;

        PayerRecord storage rec = _records[payer];
        rec.settledCount += 1;
        rec.settledDrops += inv.amountDrops;
        if (rb.blockTimestamp > rec.lastOutcomeTimestamp) {
            rec.lastOutcomeTimestamp = rb.blockTimestamp;
        }

        emit InvoiceSettled(
            invoiceId,
            inv.destinationTag,
            payer,
            uint256(rb.receivedAmount),
            rb.blockNumber,
            rb.blockTimestamp
        );
    }

    // -------------------------------------------------------------------------
    // Outcome: the mark
    // -------------------------------------------------------------------------

    /**
     * @notice Permanently mark an invoice delinquent with an FDC-proved absence of payment.
     * @dev The whole integrity of this path rests on the request body: a nonexistence proof
     *      is only meaningful relative to the window and criteria it was requested over, so
     *      every one of those parameters must equal the terms fixed at issuance. Without
     *      this, a creditor could prove "no payment" over a one-ledger window and mark a
     *      payer who settled perfectly well.
     */
    function markDelinquent(uint256 invoiceId, IXRPPaymentNonexistence.Proof calldata proof)
        external
    {
        Invoice storage inv = _open(invoiceId);

        if (!_xrpNonexistenceVerification().verifyXRPPaymentNonexistence(proof)) {
            revert InvalidProof();
        }

        IXRPPaymentNonexistence.RequestBody calldata rq = proof.data.requestBody;

        if (rq.destinationAddressHash != inv.payeeAddressHash) revert ProofMismatch("payee");
        if (rq.amount != inv.amountDrops) revert ProofMismatch("amount");
        if (rq.minimalBlockNumber != inv.minimalBlockNumber) revert ProofMismatch("minimalBlockNumber");
        if (rq.deadlineBlockNumber != inv.deadlineBlockNumber) revert ProofMismatch("deadlineBlockNumber");
        if (rq.deadlineTimestamp != inv.deadlineTimestamp) revert ProofMismatch("deadlineTimestamp");
        if (!rq.checkDestinationTag || rq.destinationTag != inv.destinationTag) {
            revert ProofMismatch("destinationTag");
        }
        // A memo constraint would narrow the search beyond the invoice's own terms, which
        // would make the absence easier to prove than the invoice warrants.
        if (rq.checkFirstMemoData) revert ProofMismatch("checkFirstMemoData");

        IXRPPaymentNonexistence.ResponseBody calldata rb = proof.data.responseBody;

        bytes32 payer = inv.payerAddressHash;

        inv.status = Status.Delinquent;
        inv.outcomeTimestamp = rb.firstOverflowBlockTimestamp;

        // Two reasons a mark may not reach anyone's record:
        //   - a bearer invoice names no debtor at all;
        //   - the named debtor never admitted the debt, so the proof shows only that an
        //     unagreed demand went unpaid, which says nothing about their creditworthiness.
        // The invoice still carries the outcome either way; the record is the thing that
        // has to stay trustworthy, because third parties lend against it.
        bool counted = payer != bytes32(0) && inv.acknowledged;

        if (counted) {
            PayerRecord storage rec = _records[payer];
            rec.delinquentCount += 1;
            rec.delinquentDrops += inv.amountDrops;
            if (rb.firstOverflowBlockTimestamp > rec.lastOutcomeTimestamp) {
                rec.lastOutcomeTimestamp = rb.firstOverflowBlockTimestamp;
            }
        }

        emit InvoiceMarkedDelinquent(
            invoiceId,
            inv.destinationTag,
            payer,
            inv.amountDrops,
            rb.firstOverflowBlockNumber,
            rb.firstOverflowBlockTimestamp,
            counted
        );
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function getInvoice(uint256 invoiceId) external view returns (Invoice memory) {
        Invoice memory inv = _invoices[invoiceId];
        if (inv.status == Status.None) revert NoSuchInvoice(invoiceId);
        return inv;
    }

    function getInvoiceByTag(uint32 destinationTag) external view returns (Invoice memory) {
        uint256 id = invoiceIdByTag[destinationTag];
        if (id == 0) revert NoSuchInvoice(0);
        return _invoices[id];
    }

    /// @notice The permanent payment record of one XRPL account, as the scorer reads it.
    function record(bytes32 payerAddressHash) external view returns (PayerRecord memory) {
        return _records[payerAddressHash];
    }

    /**
     * @notice Whether the invoice's deadline has passed in XRPL terms, i.e. whether it is
     *         worth requesting a nonexistence attestation yet. Advisory only — the FDC
     *         decides, using the ledger's own close times.
     */
    function isPastDeadline(uint256 invoiceId, uint64 xrplTimeNow) external view returns (bool) {
        Invoice storage inv = _invoices[invoiceId];
        if (inv.status == Status.None) revert NoSuchInvoice(invoiceId);
        return xrplTimeNow > inv.deadlineTimestamp;
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    function _open(uint256 invoiceId) private view returns (Invoice storage inv) {
        inv = _invoices[invoiceId];
        if (inv.status == Status.None) revert NoSuchInvoice(invoiceId);
        // The one-outcome guard: once settled or marked, an invoice is closed for good.
        if (inv.status != Status.Open) revert InvoiceNotOpen(invoiceId, inv.status);
    }

    function _verifier() private view returns (address) {
        if (fdcVerificationOverride != address(0)) return fdcVerificationOverride;
        return address(ContractRegistry.getFdcVerification());
    }

    function _xrpPaymentVerification() private view returns (IXRPPaymentVerification) {
        return IXRPPaymentVerification(_verifier());
    }

    function _xrpNonexistenceVerification()
        private
        view
        returns (IXRPPaymentNonexistenceVerification)
    {
        return IXRPPaymentNonexistenceVerification(_verifier());
    }
}
