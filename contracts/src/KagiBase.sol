// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Bip340} from "./Bip340.sol";

/// @title KagiBase
/// @notice An account owned by one x-only threshold Schnorr key. Every call needs a BIP340
/// signature over
///   m = sha256("KAGI/evm" || chainid || this || nonce || to || value || data)
/// The Kagi Wallet rebuilds m itself from what it shows on screen before it signs. Anyone may
/// submit a signed call and pay its gas (in practice the phone's gas wallet).
///
/// Storage: slot 0 nonce, slot 1 groupKey. Children append after these; the phone and the
/// agent MCP server read these slots directly, so don't reorder them.
abstract contract KagiBase {
    /// Messages signed by the group key. Bumped by every signed action, so none replays.
    uint256 public nonce;
    /// x coordinate of the group key. Key generation forces it to even y.
    uint256 public groupKey;

    event Executed(uint256 indexed nonce, address indexed to, uint256 value);

    constructor(uint256 groupKey_) payable {
        groupKey = groupKey_;
    }

    receive() external payable {}

    function digest(address to, uint256 value, bytes calldata data) public view returns (bytes32) {
        return sha256(abi.encodePacked("KAGI/evm", block.chainid, address(this), nonce, to, value, data));
    }

    /// Runs any call the group key signed. A failing call reverts with the callee's reason.
    function execute(address to, uint256 value, bytes calldata data, uint256 rx, uint256 s) external {
        require(Bip340.verify(digest(to, value, data), rx, s, groupKey), "bad signature");
        uint256 n = nonce++;
        emit Executed(n, to, value);
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
