// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LeashAccount
/// @notice A smart account owned by Leash's 2-of-2 threshold Schnorr key (phone + wrist).
/// Neither device holds the full key. Every call needs a BIP340 signature over
///   m = sha256("LEASH/evm" || chainid || this || nonce || to || value || data)
/// The wrist rebuilds m itself from what it shows on screen before it signs.
/// Anyone may submit a signed call and pay its gas.
contract LeashAccount {
    uint256 private constant P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;
    uint256 private constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    /// sha256("BIP0340/challenge")
    bytes32 private constant TAG = 0x7bb52d7a9fef58323eb1bf7a407db382d2f3f2d81bb1224f49fe518f6d48d37c;

    /// x coordinate of the group key. Key generation forces it to even y.
    uint256 public immutable groupKey;
    uint256 public nonce;

    event Executed(uint256 indexed nonce, address indexed to, uint256 value);

    constructor(uint256 px) payable {
        groupKey = px;
    }

    receive() external payable {}

    function digest(address to, uint256 value, bytes calldata data) public view returns (bytes32) {
        return sha256(abi.encodePacked("LEASH/evm", block.chainid, address(this), nonce, to, value, data));
    }

    function execute(address to, uint256 value, bytes calldata data, uint256 rx, uint256 s) external {
        require(verify(digest(to, value, data), rx, s), "bad signature");
        emit Executed(nonce++, to, value);
        (bool ok, ) = to.call{value: value}(data);
        require(ok, "call failed");
    }

    /// BIP340 verification using ecrecover for the curve math.
    /// ecrecover(z, v, r, s') returns the address of r^-1 (s' R - z G), where R is the point
    /// with x = r. With R = group key, z = -s*px and s' = -e*px that is s G - e P, which
    /// must equal the nonce point (rx, even y).
    function verify(bytes32 m, uint256 rx, uint256 s) public view returns (bool) {
        uint256 px = groupKey;
        if (rx >= P || s == 0 || s >= N) return false;
        uint256 e = uint256(sha256(abi.encodePacked(TAG, TAG, rx, px, m))) % N;
        address q = ecrecover(bytes32(N - mulmod(s, px, N)), 27, bytes32(px), bytes32(N - mulmod(e, px, N)));
        uint256 c = addmod(mulmod(mulmod(rx, rx, P), rx, P), 7, P);
        uint256 ry = _pow(c, (P + 1) / 4);
        if (mulmod(ry, ry, P) != c) return false;
        if (ry & 1 == 1) ry = P - ry;
        return q != address(0) && q == address(uint160(uint256(keccak256(abi.encodePacked(rx, ry)))));
    }

    function _pow(uint256 b, uint256 ex) private view returns (uint256 r) {
        (bool ok, bytes memory out) = address(5).staticcall(abi.encode(32, 32, 32, b, ex, P));
        require(ok, "modexp");
        r = abi.decode(out, (uint256));
    }
}
