// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { ITeeExtensionRegistry } from "./interfaces/ITeeExtensionRegistry.sol";
import { ITeeMachineRegistry } from "./interfaces/ITeeMachineRegistry.sol";

/// @title ScoreInstructionSender
/// @notice On-chain entry point for Plime Confidential: asks a TEE to compute a
///         creditworthiness score for one XRPL account from its InvoiceRegistry record.
///
///         The privacy claim rests on what crosses this boundary. The instruction carries
///         only the account hash; the enclave reads the account's full outcome history from
///         the registry itself and returns a single score. The history is never an argument,
///         never a return value, and never leaves the TEE — the caller learns the score and
///         nothing else, and the enclave's attestation is what makes that claim checkable
///         rather than merely asserted.
///
/// DO NOT MODIFY: constructor, setExtensionId(), _getExtensionId()
contract ScoreInstructionSender {
    /// @notice Operation type for creditworthiness scoring.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_TYPE_SCORING = bytes32("SCORING");

    /// @notice Command: score a single XRPL account.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_SCORE_PAYER = bytes32("SCORE_PAYER");

    /// @notice Reference to the TEE extension registry contract.
    ITeeExtensionRegistry public immutable TEE_EXTENSION_REGISTRY;
    /// @notice Reference to the TEE machine registry contract.
    ITeeMachineRegistry public immutable TEE_MACHINE_REGISTRY;

    /// @notice The InvoiceRegistry the enclave reads outcome history from.
    address public immutable INVOICE_REGISTRY;

    /// @notice First public extension ID; the registry reserves IDs below this.
    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000; // 65536

    uint256 private _extensionId;

    /// @notice Payload for a SCORE_PAYER instruction.
    /// @param invoiceRegistry Registry to read from — pinned so a caller cannot point the
    ///        enclave at a registry of their own with fabricated history.
    /// @param payerAddressHash Standard address hash of the XRPL account to score.
    struct ScorePayerMessage {
        address invoiceRegistry;
        bytes32 payerAddressHash;
    }

    constructor(
        ITeeExtensionRegistry _teeExtensionRegistry,
        ITeeMachineRegistry _teeMachineRegistry,
        address _invoiceRegistry
    ) {
        require(address(_teeExtensionRegistry) != address(0), "TeeExtensionRegistry cannot be zero address");
        require(address(_teeMachineRegistry) != address(0), "TeeMachineRegistry cannot be zero address");
        require(address(_teeExtensionRegistry).code.length > 0, "TeeExtensionRegistry has no code");
        require(address(_teeMachineRegistry).code.length > 0, "TeeMachineRegistry has no code");
        require(_invoiceRegistry != address(0), "InvoiceRegistry cannot be zero address");
        require(_invoiceRegistry.code.length > 0, "InvoiceRegistry has no code");
        TEE_EXTENSION_REGISTRY = _teeExtensionRegistry;
        TEE_MACHINE_REGISTRY = _teeMachineRegistry;
        INVOICE_REGISTRY = _invoiceRegistry;
    }

    /// @notice Finds and sets this contract's extension id. Can only be set once.
    /// DO NOT MODIFY this function.
    function setExtensionId() external {
        require(_extensionId == 0, "Extension ID already set.");

        uint256 c = TEE_EXTENSION_REGISTRY.nextPublicExtensionId();
        for (uint256 i = FIRST_PUBLIC_EXTENSION_ID; i < c; ++i) {
            if (TEE_EXTENSION_REGISTRY.getTeeExtensionInstructionsSender(i) == address(this)) {
                _extensionId = i;
                return;
            }
        }
        revert("Extension ID not found.");
    }

    /// @notice Ask a TEE to score one XRPL account's payment history.
    /// @param _payerAddressHash Standard address hash of the account to score.
    function requestScore(bytes32 _payerAddressHash) external payable {
        require(_payerAddressHash != bytes32(0), "payerAddressHash cannot be zero");

        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);

        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_SCORING,
            opCommand: OP_COMMAND_SCORE_PAYER,
            message: abi.encode(
                ScorePayerMessage({
                    invoiceRegistry: INVOICE_REGISTRY,
                    payerAddressHash: _payerAddressHash
                })
            ),
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });

        TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(teeIds, params);
    }

    /// @notice Returns the cached extension ID, reverting if not yet set.
    function _getExtensionId() internal view returns (uint256) {
        require(_extensionId != 0, "Extension ID is not set.");
        return _extensionId;
    }
}
