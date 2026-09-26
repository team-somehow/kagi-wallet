// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KagiBase} from "./KagiBase.sol";

/// @title RootTreasury
/// @notice A minimal Kagi account owned by the 3-of-3 root key (phone + wrist + vault).
/// Same call format as KagiAccount.execute, so the same signing code works. Holding the
/// vault's share means every call here needed an IR round with the vault.
contract RootTreasury is KagiBase {
    constructor(uint256 rootKey) payable KagiBase(rootKey) {}
}
