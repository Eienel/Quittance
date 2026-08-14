// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IXRPPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPayment.sol";
import {IXRPPaymentNonexistence} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPaymentNonexistence.sol";
import {IXRPPaymentVerification} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPaymentVerification.sol";
import {IXRPPaymentNonexistenceVerification} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPaymentNonexistenceVerification.sol";

/**
 * @notice Stands in for the on-chain FdcVerification contract in unit tests.
 * @dev Real verification is a Merkle proof against the relayed root, which unit tests
 *      cannot produce. Everything downstream of "the proof is valid" - the term checks,
 *      the one-outcome guard, the record accounting - is what these tests exercise, so
 *      this mock only controls the accept/reject bit.
 */
contract MockFdcVerification is IXRPPaymentVerification, IXRPPaymentNonexistenceVerification {
    bool public accept = true;

    function setAccept(bool _accept) external {
        accept = _accept;
    }

    function verifyXRPPayment(IXRPPayment.Proof calldata) external view returns (bool) {
        return accept;
    }

    function verifyXRPPaymentNonexistence(IXRPPaymentNonexistence.Proof calldata)
        external
        view
        returns (bool)
    {
        return accept;
    }
}
