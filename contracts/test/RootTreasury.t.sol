// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RootTreasury} from "../src/RootTreasury.sol";
import {SchnorrTest} from "./utils/Schnorr.sol";
import {Reverter, Target} from "./utils/Mocks.sol";

contract RootTreasuryTest is SchnorrTest {
    uint256 constant ROOT = 0x7007; // stands in for the phone + Kagi Wallet + vault group secret
    uint256 constant MANAGER = 0xA11CE;

    RootTreasury t;
    address payable to = payable(address(0xdEaD));

    function setUp() public {
        t = new RootTreasury{value: 5 ether}(xonly(ROOT));
    }

    function exec(uint256 key, address target, uint256 value, bytes memory data) internal {
        (uint256 rx, uint256 s) = schnorrSign(key, t.digest(target, value, data));
        t.execute(target, value, data, rx, s);
    }

    function test_Execute() public {
        exec(ROOT, to, 1 ether, "");
        assertEq(to.balance, 1 ether);
        assertEq(t.nonce(), 1);
    }

    function test_ExecuteCallsContract() public {
        Target tg = new Target();
        exec(ROOT, address(tg), 0, abi.encodeCall(Target.set, (9)));
        assertEq(tg.last(), 9);
    }

    /// The manager key (phone + Kagi Wallet) can't touch the treasury: it needs the vault.
    function test_RevertWhen_SignedByManagerKey() public {
        (uint256 rx, uint256 s) = schnorrSign(MANAGER, t.digest(to, 1, ""));
        vm.expectRevert(bytes("bad signature"));
        t.execute(to, 1, "", rx, s);
    }

    function test_RevertWhen_Replayed() public {
        (uint256 rx, uint256 s) = schnorrSign(ROOT, t.digest(to, 1, ""));
        t.execute(to, 1, "", rx, s);
        vm.expectRevert(bytes("bad signature"));
        t.execute(to, 1, "", rx, s);
    }

    function test_RevertWhen_CalleeReverts() public {
        address r = address(new Reverter());
        bytes memory data = abi.encodeCall(Reverter.boom, ());
        (uint256 rx, uint256 s) = schnorrSign(ROOT, t.digest(r, 0, data));
        vm.expectRevert(bytes("boom"));
        t.execute(r, 0, data, rx, s);
    }

    function test_StorageLayout() public view {
        assertEq(uint256(vm.load(address(t), bytes32(uint256(0)))), 0);
        assertEq(uint256(vm.load(address(t), bytes32(uint256(1)))), t.groupKey());
    }
}
