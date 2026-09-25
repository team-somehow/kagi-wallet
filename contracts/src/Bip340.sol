// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Bip340
/// @notice BIP340 Schnorr verification on secp256k1, using ecrecover for the curve math.
///
/// The FROST keys (manager 2-of-2, root 3-of-3) produce ordinary BIP340 signatures, so the
/// contracts only ever see one x-only group key and one (rx, s) pair.
///
/// ecrecover(z, v, r, s') returns the address of r^-1 (s' R - z G), where R is the point with
/// x = r and parity from v. With R = P (the group key, even y), z = -s*px and s' = -e*px that
/// is s G - e P, which must equal the nonce point (rx, even y).
library Bip340 {
    uint256 internal constant P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;
    uint256 internal constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    /// sha256("BIP0340/challenge")
    bytes32 internal constant TAG = 0x7bb52d7a9fef58323eb1bf7a407db382d2f3f2d81bb1224f49fe518f6d48d37c;

    /// Returns true iff (rx, s) is a valid BIP340 signature by x-only key px over m.
    /// Never reverts, so callers can try several keys (the phone or the manager).
    function verify(bytes32 m, uint256 rx, uint256 s, uint256 px) internal view returns (bool) {
        if (px == 0 || px >= P || rx >= P || s == 0 || s >= N) return false;
        uint256 e = uint256(sha256(abi.encodePacked(TAG, TAG, rx, px, m))) % N;
        address q = ecrecover(bytes32(N - mulmod(s, px, N)), 27, bytes32(px), bytes32(N - mulmod(e, px, N)));
        if (q == address(0)) return false;
        uint256 c = addmod(mulmod(mulmod(rx, rx, P), rx, P), 7, P);
        (bool ok, uint256 ry) = _sqrt(c);
        if (!ok) return false;
        if (ry & 1 == 1) ry = P - ry;
        return q == address(uint160(uint256(keccak256(abi.encodePacked(rx, ry)))));
    }

    /// Square root mod P via the modexp precompile: c^((P+1)/4). ok is false if c is not a square.
    function _sqrt(uint256 c) private view returns (bool ok, uint256 r) {
        (bool success, bytes memory out) = address(5).staticcall(abi.encode(32, 32, 32, c, (P + 1) / 4, P));
        if (success && out.length == 32) {
            r = abi.decode(out, (uint256));
            ok = mulmod(r, r, P) == c;
        }
    }
}
