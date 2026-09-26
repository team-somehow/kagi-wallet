// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KagiAccount} from "../src/KagiAccount.sol";

/// Signatures from the real phone + Kagi Wallet FROST code (hub/gen-fixtures.ts), checked on the
/// contract. Fails if the TypeScript message builders and the Solidity digests drift apart.
contract FrostFixtureTest is Test {
    string json;
    KagiAccount acct;

    function setUp() public {
        json = vm.readFile("test/fixtures/frost.json");
        vm.chainId(vm.parseJsonUint(json, ".chainId"));
        address at = vm.parseJsonAddress(json, ".account");
        deployCodeTo(
            "KagiAccount.sol:KagiAccount",
            abi.encode(vm.parseJsonUint(json, ".groupKey"), vm.parseJsonUint(json, ".phoneKey")),
            at
        );
        acct = KagiAccount(payable(at));
        vm.deal(at, 1 ether);
        vm.warp(1_900_000_000);
    }

    function sig(string memory key) internal view returns (uint256 rx, uint256 s) {
        return abi.decode(vm.parseJsonBytes(json, key), (uint256, uint256));
    }

    function test_RealFrostSignaturesAccepted() public {
        address agent = vm.parseJsonAddress(json, ".agent");
        address to = vm.parseJsonAddress(json, ".to");
        uint256 cap = vm.parseJsonUint(json, ".cap");
        uint256 expiry = vm.parseJsonUint(json, ".expiry");

        (uint256 rx, uint256 s) = sig(".grantSig");
        acct.grant(agent, cap, expiry, rx, s);
        (uint256 c,, uint256 e,) = acct.session(agent);
        assertEq(c, cap);
        assertEq(e, expiry);

        (rx, s) = sig(".executeSig");
        acct.execute(to, 1, vm.parseJsonBytes(json, ".data"), rx, s);
        assertEq(to.balance, 1);

        (rx, s) = sig(".revokeSig");
        acct.revoke(agent, rx, s);
        (,, e,) = acct.session(agent);
        assertEq(e, 0);
        assertEq(acct.nonce(), 3);
    }

    function test_RealFrost1271() public view {
        bytes32 hash = vm.parseJsonBytes32(json, ".hash");
        assertEq(acct.isValidSignature(hash, vm.parseJsonBytes(json, ".sig1271")), bytes4(0x1626ba7e));
    }
}
