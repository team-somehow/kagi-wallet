// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LeashBase} from "./LeashBase.sol";

/// @title RootTreasury
/// @notice A minimal Leash account owned by the 3-of-3 root key (phone + wrist + vault).
/// Same call format as LeashAccount.execute, so the same signing code works. Holding the
/// vault's share means every call here needed an IR round with the vault.
contract RootTreasury is LeashBase {
    constructor(uint256 rootKey) payable LeashBase(rootKey) {}
}
