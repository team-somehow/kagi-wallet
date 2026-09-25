// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";

/// BIP340 signing for tests. The contracts only ever see the aggregate FROST signature,
/// which is an ordinary BIP340 signature, so a single secret stands in for the group here.
/// test/Frost.t.sol covers signatures from the real threshold code.
abstract contract SchnorrTest is Test {
    uint256 internal constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    bytes32 internal constant TAG = 0x7bb52d7a9fef58323eb1bf7a407db382d2f3f2d81bb1224f49fe518f6d48d37c;

    /// x-only public key of secret d.
    function xonly(uint256 d) internal returns (uint256) {
        return vm.createWallet(d).publicKeyX;
    }

    function schnorrSign(uint256 d, bytes32 m) internal returns (uint256 rx, uint256 s) {
        Vm.Wallet memory w = vm.createWallet(d);
        if (w.publicKeyY & 1 == 1) d = N - d;
        uint256 k = uint256(keccak256(abi.encode(d, m, "nonce"))) % (N - 1) + 1;
        Vm.Wallet memory r = vm.createWallet(k);
        if (r.publicKeyY & 1 == 1) k = N - k;
        rx = r.publicKeyX;
        uint256 e = uint256(sha256(abi.encodePacked(TAG, TAG, rx, w.publicKeyX, m))) % N;
        s = addmod(k, mulmod(e, d, N), N);
    }

    function schnorrSig(uint256 d, bytes32 m) internal returns (bytes memory) {
        (uint256 rx, uint256 s) = schnorrSign(d, m);
        return abi.encodePacked(rx, s);
    }
}
