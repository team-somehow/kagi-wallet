// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LeashAccount} from "../src/LeashAccount.sol";
import {SchnorrTest} from "./utils/Schnorr.sol";
import {MockMulti, MockNFT, Reverter, Target} from "./utils/Mocks.sol";

contract LeashAccountTest is SchnorrTest {
    event Executed(uint256 indexed nonce, address indexed to, uint256 value);
    event Granted(address indexed agent, uint256 cap, uint256 expiry);
    event Revoked(address indexed agent);
    event Spent(address indexed agent, address indexed to, uint256 value);

    uint256 constant MANAGER = 0xA11CE; // stands in for the phone + wrist group secret
    uint256 constant PHONE = 0xB0B;
    uint256 constant AGENT_PK = 0xA6E17;
    uint256 constant CAP = 1 ether;

    LeashAccount acct;
    address agent;
    address payable to = payable(address(0xdEaD));
    uint256 expiry;

    function setUp() public {
        acct = new LeashAccount{value: 10 ether}(xonly(MANAGER), xonly(PHONE));
        agent = vm.addr(AGENT_PK);
        expiry = block.timestamp + 1 days;
    }

    // ---- helpers -------------------------------------------------------------------------

    function grantMsg(LeashAccount a, uint256 n, address ag, uint256 cap, uint256 exp) internal view returns (bytes32) {
        return sha256(abi.encodePacked("LEASH/grant", block.chainid, address(a), n, ag, cap, exp));
    }

    function revokeMsg(uint256 n, address ag) internal view returns (bytes32) {
        return sha256(abi.encodePacked("LEASH/revoke", block.chainid, address(acct), n, ag));
    }

    function wrap1271(LeashAccount a, bytes32 h) internal view returns (bytes32) {
        return sha256(abi.encodePacked("LEASH/1271", block.chainid, address(a), h));
    }

    function doGrant(uint256 cap) internal {
        (uint256 rx, uint256 s) = schnorrSign(MANAGER, grantMsg(acct, acct.nonce(), agent, cap, expiry));
        acct.grant(agent, cap, expiry, rx, s);
    }

    function doExecute(address target, uint256 value, bytes memory data) internal {
        (uint256 rx, uint256 s) = schnorrSign(MANAGER, acct.digest(target, value, data));
        acct.execute(target, value, data, rx, s);
    }

    function spendSig(uint256 pk, uint256 sn, address dst, uint256 value)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 h = keccak256(abi.encodePacked("LEASH/spend", block.chainid, address(acct), agent, sn, dst, value));
        return vm.sign(pk, h);
    }

    function doSpend(address dst, uint256 value) internal {
        (,,, uint256 sn) = acct.session(agent);
        (uint8 v, bytes32 r, bytes32 s) = spendSig(AGENT_PK, sn, dst, value);
        acct.spend(agent, dst, value, v, r, s);
    }

    // ---- grant ---------------------------------------------------------------------------

    function test_Grant() public {
        vm.expectEmit(address(acct));
        emit Granted(agent, CAP, expiry);
        doGrant(CAP);
        (uint256 cap, uint256 spent, uint256 exp, uint256 sn) = acct.session(agent);
        assertEq(cap, CAP);
        assertEq(spent, 0);
        assertEq(exp, expiry);
        assertEq(sn, 0);
        assertEq(acct.nonce(), 1);
    }

    function test_RevertWhen_GrantReplayed() public {
        (uint256 rx, uint256 s) = schnorrSign(MANAGER, grantMsg(acct, 0, agent, CAP, expiry));
        acct.grant(agent, CAP, expiry, rx, s);
        vm.expectRevert(bytes("bad signature"));
        acct.grant(agent, CAP, expiry, rx, s);
    }

    function test_RevertWhen_GrantSignedByPhoneAlone() public {
        (uint256 rx, uint256 s) = schnorrSign(PHONE, grantMsg(acct, 0, agent, CAP, expiry));
        vm.expectRevert(bytes("bad signature"));
        acct.grant(agent, CAP, expiry, rx, s);
    }

    function test_RevertWhen_GrantFieldsChanged() public {
        (uint256 rx, uint256 s) = schnorrSign(MANAGER, grantMsg(acct, 0, agent, CAP, expiry));
        vm.expectRevert(bytes("bad signature"));
        acct.grant(agent, CAP + 1, expiry, rx, s);
    }

    function test_RegrantResetsSpent() public {
        doGrant(CAP);
        doSpend(to, 0.4 ether);
        doGrant(CAP);
        (, uint256 spent,,) = acct.session(agent);
        assertEq(spent, 0);
    }

    function limitSig(uint256 oldCap, uint256 newCap, uint256 exp, uint256 key) internal returns (uint256, uint256) {
        return schnorrSign(key, sha256(abi.encodePacked("LEASH/limit", block.chainid, address(acct), acct.nonce(), agent, oldCap, newCap, exp)));
    }

    function test_RaisePreservesSpendExpiryAndAgentNonce() public {
        doGrant(CAP);
        doSpend(to, 0.4 ether);
        (uint256 rx, uint256 s) = limitSig(CAP, 2 ether, expiry, MANAGER);
        acct.raiseLimit(agent, CAP, 2 ether, expiry, rx, s);
        (uint256 cap, uint256 spent, uint256 exp, uint256 sn) = acct.session(agent);
        assertEq(cap, 2 ether);
        assertEq(spent, 0.4 ether);
        assertEq(exp, expiry);
        assertEq(sn, 1);
        doSpend(to, 1.6 ether);
        assertEq(to.balance, 2 ether);
    }

    function test_RaiseRejectsReplayOrChangedFields() public {
        doGrant(CAP);
        (uint256 rx, uint256 s) = limitSig(CAP, 2 ether, expiry, MANAGER);
        vm.expectRevert(bytes("bad signature"));
        acct.raiseLimit(agent, CAP, 3 ether, expiry, rx, s);
        acct.raiseLimit(agent, CAP, 2 ether, expiry, rx, s);
        vm.expectRevert(bytes("session changed"));
        acct.raiseLimit(agent, CAP, 2 ether, expiry, rx, s);
    }

    function test_RaiseCannotReviveRevokedOrExpiredKey() public {
        doGrant(CAP);
        (uint256 rx, uint256 s) = limitSig(CAP, 2 ether, expiry, MANAGER);
        vm.warp(expiry);
        vm.expectRevert(bytes("key expired or revoked"));
        acct.raiseLimit(agent, CAP, 2 ether, expiry, rx, s);
        vm.warp(expiry - 1);
        (uint256 rrx, uint256 rs) = schnorrSign(PHONE, revokeMsg(acct.nonce(), agent));
        acct.revoke(agent, rrx, rs);
        vm.expectRevert(bytes("key expired or revoked"));
        acct.raiseLimit(agent, CAP, 2 ether, expiry, rx, s);
    }

    function test_RaiseRequiresManagerAndUnchangedExpiry() public {
        doGrant(CAP);
        (uint256 rx, uint256 s) = limitSig(CAP, 2 ether, expiry, PHONE);
        vm.expectRevert(bytes("bad signature"));
        acct.raiseLimit(agent, CAP, 2 ether, expiry, rx, s);
        vm.expectRevert(bytes("session changed"));
        acct.raiseLimit(agent, CAP, 2 ether, expiry + 1, rx, s);
        vm.expectRevert(bytes("limit must increase"));
        acct.raiseLimit(agent, CAP, CAP, expiry, rx, s);
    }

    // ---- spend ---------------------------------------------------------------------------

    function test_SpendUnderCap() public {
        doGrant(CAP);
        vm.expectEmit(address(acct));
        emit Spent(agent, to, 0.4 ether);
        doSpend(to, 0.4 ether);
        assertEq(to.balance, 0.4 ether);
        (, uint256 spent,, uint256 sn) = acct.session(agent);
        assertEq(spent, 0.4 ether);
        assertEq(sn, 1);
    }

    function test_SpendExactlyTheCap() public {
        doGrant(CAP);
        doSpend(to, 0.4 ether);
        doSpend(to, 0.6 ether);
        assertEq(to.balance, CAP);
    }

    function test_RevertWhen_SpendOverCap() public {
        doGrant(CAP);
        doSpend(to, 0.4 ether);
        (uint8 v, bytes32 r, bytes32 s) = spendSig(AGENT_PK, 1, to, 0.6 ether + 1);
        vm.expectRevert(bytes("over the cap"));
        acct.spend(agent, to, 0.6 ether + 1, v, r, s);
    }

    function test_RevertWhen_SpendReplayed() public {
        doGrant(CAP);
        (uint8 v, bytes32 r, bytes32 s) = spendSig(AGENT_PK, 0, to, 0.1 ether);
        acct.spend(agent, to, 0.1 ether, v, r, s);
        vm.expectRevert(bytes("bad agent signature"));
        acct.spend(agent, to, 0.1 ether, v, r, s);
    }

    function test_RevertWhen_SpendSignedByOtherKey() public {
        doGrant(CAP);
        (uint8 v, bytes32 r, bytes32 s) = spendSig(0xBAD, 0, to, 1);
        vm.expectRevert(bytes("bad agent signature"));
        acct.spend(agent, to, 1, v, r, s);
    }

    function test_RevertWhen_SpendRedirected() public {
        doGrant(CAP);
        (uint8 v, bytes32 r, bytes32 s) = spendSig(AGENT_PK, 0, to, 1);
        vm.expectRevert(bytes("bad agent signature"));
        acct.spend(agent, address(0xBEEF), 1, v, r, s);
    }

    function test_RevertWhen_SpendByZeroAgent() public {
        vm.expectRevert(bytes("bad agent signature"));
        acct.spend(address(0), to, 0, 27, bytes32(0), bytes32(0));
    }

    function test_RevertWhen_SpendWithoutGrant() public {
        (uint8 v, bytes32 r, bytes32 s) = spendSig(AGENT_PK, 0, to, 0);
        vm.expectRevert(bytes("key expired or revoked"));
        acct.spend(agent, to, 0, v, r, s);
    }

    function test_RevertWhen_SpendAfterExpiry() public {
        doGrant(CAP);
        vm.warp(expiry);
        (uint8 v, bytes32 r, bytes32 s) = spendSig(AGENT_PK, 0, to, 1);
        vm.expectRevert(bytes("key expired or revoked"));
        acct.spend(agent, to, 1, v, r, s);
    }

    function test_RevertWhen_SpendToSelf() public {
        doGrant(CAP);
        (uint8 v, bytes32 r, bytes32 s) = spendSig(AGENT_PK, 0, address(acct), 1);
        vm.expectRevert(bytes("no self calls"));
        acct.spend(agent, address(acct), 1, v, r, s);
    }

    function test_RevertWhen_SpendRecipientRejects() public {
        doGrant(CAP);
        address rejector = address(new Reverter()); // no receive(), so ETH bounces
        (uint8 v, bytes32 r, bytes32 s) = spendSig(AGENT_PK, 0, rejector, 1);
        vm.expectRevert(bytes("transfer failed"));
        acct.spend(agent, rejector, 1, v, r, s);
    }

    /// Whatever sequence of spends the agent tries, what leaves the account never exceeds the cap.
    function testFuzz_SpendNeverExceedsCap(uint96[8] calldata amounts) public {
        doGrant(CAP);
        uint256 before = address(acct).balance;
        uint256 accepted;
        for (uint256 i; i < amounts.length; i++) {
            uint256 value = uint256(amounts[i]) % (CAP / 2);
            (,,, uint256 sn) = acct.session(agent);
            (uint8 v, bytes32 r, bytes32 s) = spendSig(AGENT_PK, sn, to, value);
            try acct.spend(agent, to, value, v, r, s) {
                accepted += value;
            } catch {}
        }
        assertLe(accepted, CAP);
        assertEq(before - address(acct).balance, accepted);
        (, uint256 spent,,) = acct.session(agent);
        assertEq(spent, accepted);
    }

    // ---- revoke --------------------------------------------------------------------------

    function test_RevokeByPhoneAlone() public {
        doGrant(CAP);
        (uint256 rx, uint256 s) = schnorrSign(PHONE, revokeMsg(1, agent));
        vm.expectEmit(address(acct));
        emit Revoked(agent);
        acct.revoke(agent, rx, s);
        (uint8 v, bytes32 r, bytes32 ss) = spendSig(AGENT_PK, 0, to, 1);
        vm.expectRevert(bytes("key expired or revoked"));
        acct.spend(agent, to, 1, v, r, ss);
    }

    function test_RevokeByManager() public {
        doGrant(CAP);
        (uint256 rx, uint256 s) = schnorrSign(MANAGER, revokeMsg(1, agent));
        acct.revoke(agent, rx, s);
        (,, uint256 exp,) = acct.session(agent);
        assertEq(exp, 0);
    }

    function test_RevertWhen_RevokeByStranger() public {
        doGrant(CAP);
        (uint256 rx, uint256 s) = schnorrSign(0xBAD, revokeMsg(1, agent));
        vm.expectRevert(bytes("bad signature"));
        acct.revoke(agent, rx, s);
    }

    // ---- execute -------------------------------------------------------------------------

    function test_ExecuteSendsEth() public {
        vm.expectEmit(address(acct));
        emit Executed(0, to, 2 ether);
        doExecute(to, 2 ether, "");
        assertEq(to.balance, 2 ether);
        assertEq(acct.nonce(), 1);
    }

    function test_ExecuteCallsContract() public {
        Target t = new Target();
        doExecute(address(t), 1, abi.encodeCall(Target.set, (42)));
        assertEq(t.last(), 42);
        assertEq(address(t).balance, 1);
    }

    function test_RevertWhen_ExecuteCalleeReverts() public {
        address r = address(new Reverter());
        bytes memory data = abi.encodeCall(Reverter.boom, ());
        (uint256 rx, uint256 s) = schnorrSign(MANAGER, acct.digest(r, 0, data));
        vm.expectRevert(bytes("boom"));
        acct.execute(r, 0, data, rx, s);
    }

    function test_RevertWhen_ExecuteReplayed() public {
        (uint256 rx, uint256 s) = schnorrSign(MANAGER, acct.digest(to, 1, ""));
        acct.execute(to, 1, "", rx, s);
        vm.expectRevert(bytes("bad signature"));
        acct.execute(to, 1, "", rx, s);
    }

    function test_RevertWhen_ExecuteByAgentOrPhone() public {
        (uint256 rx, uint256 s) = schnorrSign(PHONE, acct.digest(to, 1, ""));
        vm.expectRevert(bytes("bad signature"));
        acct.execute(to, 1, "", rx, s);
    }

    /// One nonce for every manager message: a grant signed for nonce 0 dies once an execute lands.
    function test_RevertWhen_GrantSignedBeforeAnExecute() public {
        (uint256 rx, uint256 s) = schnorrSign(MANAGER, grantMsg(acct, 0, agent, CAP, expiry));
        doExecute(to, 1, "");
        vm.expectRevert(bytes("bad signature"));
        acct.grant(agent, CAP, expiry, rx, s);
    }

    function test_ReceivesPlainEth() public {
        (bool ok,) = address(acct).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(acct).balance, 11 ether);
    }

    function test_RevertWhen_UnknownSelector() public {
        (bool ok,) = address(acct).call(abi.encodeWithSignature("nope()"));
        assertFalse(ok);
    }

    // ---- ERC-1271 ------------------------------------------------------------------------

    bytes32 constant ORDER = keccak256("some EIP-712 digest");

    function test_1271ManagerSignature() public {
        assertEq(acct.isValidSignature(ORDER, schnorrSig(MANAGER, wrap1271(acct, ORDER))), bytes4(0x1626ba7e));
    }

    function test_1271RejectsOtherHash() public {
        bytes memory sig = schnorrSig(MANAGER, wrap1271(acct, ORDER));
        assertEq(acct.isValidSignature(keccak256("other"), sig), bytes4(0xffffffff));
    }

    function test_1271RejectsUnwrappedHash() public {
        assertEq(acct.isValidSignature(ORDER, schnorrSig(MANAGER, ORDER)), bytes4(0xffffffff));
    }

    function test_1271RejectsPhoneAlone() public {
        assertEq(acct.isValidSignature(ORDER, schnorrSig(PHONE, wrap1271(acct, ORDER))), bytes4(0xffffffff));
    }

    /// The whole point: a live agent key must not be able to sign a permit or an order.
    function test_1271RejectsAgentKey() public {
        doGrant(CAP);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_PK, ORDER);
        assertEq(acct.isValidSignature(ORDER, abi.encodePacked(r, s, v)), bytes4(0xffffffff));
        (v, r, s) = vm.sign(AGENT_PK, wrap1271(acct, ORDER));
        assertEq(acct.isValidSignature(ORDER, abi.encodePacked(r, s, v)), bytes4(0xffffffff));
    }

    function test_1271RejectsWrongLength() public {
        bytes memory sig = schnorrSig(MANAGER, wrap1271(acct, ORDER));
        assertEq(acct.isValidSignature(ORDER, abi.encodePacked(sig, uint8(0))), bytes4(0xffffffff));
        assertEq(acct.isValidSignature(ORDER, ""), bytes4(0xffffffff));
    }

    function test_1271NotReplayableOnAnotherAccount() public {
        LeashAccount twin = new LeashAccount(xonly(MANAGER), xonly(PHONE));
        bytes memory sig = schnorrSig(MANAGER, wrap1271(acct, ORDER));
        assertEq(twin.isValidSignature(ORDER, sig), bytes4(0xffffffff));
    }

    function test_1271NotReplayableOnAnotherChain() public {
        bytes memory sig = schnorrSig(MANAGER, wrap1271(acct, ORDER));
        vm.chainId(block.chainid + 1);
        assertEq(acct.isValidSignature(ORDER, sig), bytes4(0xffffffff));
    }

    function testFuzz_1271OnlyTheSignedHash(bytes32 signed, bytes32 asked) public {
        vm.assume(signed != asked);
        bytes memory sig = schnorrSig(MANAGER, wrap1271(acct, signed));
        assertEq(acct.isValidSignature(signed, sig), bytes4(0x1626ba7e));
        assertEq(acct.isValidSignature(asked, sig), bytes4(0xffffffff));
    }

    // ---- NFTs and ERC-165 ----------------------------------------------------------------

    function test_ReceivesAndReleasesERC721() public {
        MockNFT nft = new MockNFT();
        nft.mint(address(this), 7);
        nft.safeTransferFrom(address(this), address(acct), 7);
        assertEq(nft.ownerOf(7), address(acct));
        doExecute(address(nft), 0, abi.encodeCall(MockNFT.safeTransferFrom, (address(acct), address(0xBEEF), 7)));
        assertEq(nft.ownerOf(7), address(0xBEEF));
    }

    function test_ReceivesERC1155() public {
        MockMulti m = new MockMulti();
        m.mint(address(this), 1, 5);
        m.mint(address(this), 2, 5);
        m.safeTransferFrom(address(this), address(acct), 1, 3, "");
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        (ids[0], ids[1], amounts[0], amounts[1]) = (1, 2, 2, 5);
        m.safeBatchTransferFrom(address(this), address(acct), ids, amounts, "");
        assertEq(m.balanceOf(address(acct), 1), 5);
        assertEq(m.balanceOf(address(acct), 2), 5);
    }

    function test_SupportsInterface() public view {
        assertTrue(acct.supportsInterface(0x01ffc9a7)); // ERC-165
        assertTrue(acct.supportsInterface(0x150b7a02)); // ERC-721 receiver
        assertTrue(acct.supportsInterface(0x4e2312e0)); // ERC-1155 receiver
        assertTrue(acct.supportsInterface(0x1626ba7e)); // ERC-1271
        assertFalse(acct.supportsInterface(0xffffffff));
    }

    // ---- layout the hub depends on -------------------------------------------------------

    /// hub/session-sim.ts overrides these slots directly; keep them where they are.
    function test_StorageLayout() public {
        doGrant(CAP);
        doSpend(to, 0.25 ether);
        assertEq(uint256(vm.load(address(acct), bytes32(uint256(0)))), 1);
        assertEq(uint256(vm.load(address(acct), bytes32(uint256(1)))), xonly(MANAGER));
        assertEq(uint256(vm.load(address(acct), bytes32(uint256(2)))), xonly(PHONE));
        uint256 b = uint256(keccak256(abi.encode(agent, uint256(3))));
        assertEq(uint256(vm.load(address(acct), bytes32(b))), CAP);
        assertEq(uint256(vm.load(address(acct), bytes32(b + 1))), 0.25 ether);
        assertEq(uint256(vm.load(address(acct), bytes32(b + 2))), expiry);
        assertEq(uint256(vm.load(address(acct), bytes32(b + 3))), 1);
    }
}
