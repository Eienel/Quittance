// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IRegistryBond {
    function postBond(uint256 invoiceId) external payable;
    function withdraw() external;
}

/**
 * @notice A bond poster that refuses to accept FLR.
 * @dev Exists to prove an outcome cannot be blocked by a hostile recipient. If bond
 *      proceeds were pushed instead of pulled, a contract like this could make its own
 *      invoice impossible to settle or mark.
 */
contract RejectingRecipient {
    function postBond(address registry, uint256 invoiceId) external payable {
        IRegistryBond(registry).postBond{value: msg.value}(invoiceId);
    }

    function withdraw(address registry) external {
        IRegistryBond(registry).withdraw();
    }

    receive() external payable {
        revert("I reject payment");
    }
}
