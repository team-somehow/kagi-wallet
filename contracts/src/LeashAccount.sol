// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Bip340} from "./Bip340.sol";
import {LeashBase} from "./LeashBase.sol";

/// @title LeashAccount
/// @notice The agent-facing smart account. Three kinds of signer:
///   manager key  2-of-2 threshold Schnorr (phone + wrist), BIP340. Moves anything, grants keys.
///   phone key    the phone's shard on its own, BIP340. Can only revoke.
///   session key  an agent's ephemeral ECDSA key. Spends plain ETH under its cap until it expires.
///
/// Signed messages (sha256 for Schnorr, keccak256 for the agent's ECDSA):
///   execute  sha256("LEASH/evm"    || chainid || this || nonce || to || value || data)
///   grant    sha256("LEASH/grant"  || chainid || this || nonce || agent || cap || expiry)
///   revoke   sha256("LEASH/revoke" || chainid || this || nonce || agent)
///   limit    sha256("LEASH/limit"  || chainid || this || nonce || agent || oldCap || newCap || expiry)
///   decline  sha256("LEASH/decline"|| chainid || this || nonce || agent || newCap)
///   spend    keccak256("LEASH/spend" || chainid || this || agent || sessionNonce || to || value)
///   1271     sha256("LEASH/1271"   || chainid || this || hash), signature = rx || s (64 bytes)
/// The wrist rebuilds the manager messages itself from what it shows before it signs.
///
/// Limits: the cap counts ETH value only, a session can't call contracts or this account,
/// and one session lives at most as long as its expiry (so one cap per key lifetime).
///
/// ERC-1271 answers yes for the manager key only. A Permit2 or order signature moves money
/// without passing through spend, so an agent's key must never be able to produce one. The
/// 1271 message binds chainid and this account, so a signature can't be replayed on another
/// account or chain that shares the group key. It has no nonce: replay protection for signed
/// orders and permits is the verifying app's job, as with any EOA signature.
///
/// Storage: 0 nonce, 1 groupKey, 2 phoneKey, sessions at keccak(agent . 3) + 0..3.
contract LeashAccount is LeashBase {
    struct Session {
        uint256 cap;
        uint256 spent;
        uint256 expiry;
        uint256 nonce;
    }

    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;
    bytes4 private constant ERC1271_FAIL = 0xffffffff;

    /// x coordinate of the phone's own shard public key (even y). Can only revoke.
    uint256 public phoneKey;
    mapping(address agent => Session) private _sessions;

    event Granted(address indexed agent, uint256 cap, uint256 expiry);
    event LimitRaised(address indexed agent, uint256 oldCap, uint256 newCap);
    event Revoked(address indexed agent);
    event Spent(address indexed agent, address indexed to, uint256 value);
    event LimitRequested(address indexed agent, uint256 oldCap, uint256 newCap, string reason);
    event LimitDeclined(address indexed agent, uint256 newCap);

    constructor(uint256 groupKey_, uint256 phoneKey_) payable LeashBase(groupKey_) {
        phoneKey = phoneKey_;
    }

    function session(address agent) external view returns (uint256 cap, uint256 spent, uint256 expiry, uint256 sn) {
        Session storage s = _sessions[agent];
        return (s.cap, s.spent, s.expiry, s.nonce);
    }

    // ---- manager and phone -------------------------------------------------------------

    /// Registers an agent's ephemeral key with a cap and an expiry. Replaces any earlier
    /// session for the same key and resets what it has spent.
    function grant(address agent, uint256 cap, uint256 expiry, uint256 rx, uint256 s) external {
        uint256 n = nonce;
        bytes32 m = sha256(abi.encodePacked("LEASH/grant", block.chainid, address(this), n, agent, cap, expiry));
        require(Bip340.verify(m, rx, s, groupKey), "bad signature");
        nonce = n + 1;
        Session storage sess = _sessions[agent];
        sess.cap = cap;
        sess.spent = 0;
        sess.expiry = expiry;
        emit Granted(agent, cap, expiry);
    }

    /// Raises the lifetime allowance without resetting spend, expiry or the agent nonce.
    /// Bind the displayed old cap and expiry, so stale approvals cannot revive a revoked key.
    function raiseLimit(address agent, uint256 oldCap, uint256 newCap, uint256 expiry, uint256 rx, uint256 s) external {
        Session storage sess = _sessions[agent];
        require(sess.expiry > block.timestamp, "key expired or revoked");
        require(sess.cap == oldCap && sess.expiry == expiry, "session changed");
        require(newCap > oldCap, "limit must increase");
        uint256 n = nonce;
        bytes32 m = sha256(abi.encodePacked("LEASH/limit", block.chainid, address(this), n, agent, oldCap, newCap, expiry));
        require(Bip340.verify(m, rx, s, groupKey), "bad signature");
        nonce = n + 1;
        sess.cap = newCap;
        emit LimitRaised(agent, oldCap, newCap);
    }

    /// The owner says no to a limit request. Like revoke, the phone's shard alone is enough:
    /// declining only keeps the current limit. It exists so the agent learns the answer.
    function declineLimit(address agent, uint256 newCap, uint256 rx, uint256 s) external {
        uint256 n = nonce;
        bytes32 m = sha256(abi.encodePacked("LEASH/decline", block.chainid, address(this), n, agent, newCap));
        require(Bip340.verify(m, rx, s, phoneKey) || Bip340.verify(m, rx, s, groupKey), "bad signature");
        nonce = n + 1;
        emit LimitDeclined(agent, newCap);
    }

    /// Any single shard can stop a key: the phone alone, or phone and wrist together.
    function revoke(address agent, uint256 rx, uint256 s) external {
        uint256 n = nonce;
        bytes32 m = sha256(abi.encodePacked("LEASH/revoke", block.chainid, address(this), n, agent));
        require(Bip340.verify(m, rx, s, phoneKey) || Bip340.verify(m, rx, s, groupKey), "bad signature");
        nonce = n + 1;
        _sessions[agent].expiry = 0;
        emit Revoked(agent);
    }

    // ---- agent ---------------------------------------------------------------------------

    /// A live session key asks its owner for a higher total allowance. Only the agent itself
    /// can ask (it sends the transaction and pays its gas); the phone watches for the event.
    function requestLimit(uint256 newCap, string calldata reason) external {
        Session storage sess = _sessions[msg.sender];
        require(sess.expiry > block.timestamp, "key expired or revoked");
        require(newCap > sess.cap, "limit must increase");
        require(bytes(reason).length <= 200, "reason too long");
        emit LimitRequested(msg.sender, sess.cap, newCap, reason);
    }

    /// Sends plain ETH from the account, signed by the agent's own ephemeral key. No calldata,
    /// so a session can't approve tokens or call out. Revert reasons are plain strings so the
    /// relayer can tell the phone why.
    function spend(address agent, address to, uint256 value, uint8 v, bytes32 r, bytes32 s) external {
        Session storage sess = _sessions[agent];
        uint256 sn = sess.nonce;
        bytes32 h = keccak256(abi.encodePacked("LEASH/spend", block.chainid, address(this), agent, sn, to, value));
        address signer = ecrecover(h, v, r, s);
        require(agent != address(0) && signer == agent, "bad agent signature");
        require(sess.expiry > block.timestamp, "key expired or revoked");
        uint256 spent = sess.spent + value;
        require(spent <= sess.cap, "over the cap");
        require(to != address(this), "no self calls");
        sess.spent = spent;
        sess.nonce = sn + 1;
        emit Spent(agent, to, value);
        (bool ok,) = to.call{value: value}("");
        require(ok, "transfer failed");
    }

    // ---- standards -----------------------------------------------------------------------

    /// ERC-1271. Manager key only, over the wrapped message above.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (signature.length != 64) return ERC1271_FAIL;
        bytes32 m = sha256(abi.encodePacked("LEASH/1271", block.chainid, address(this), hash));
        (uint256 rx, uint256 s) = abi.decode(signature, (uint256, uint256));
        return Bip340.verify(m, rx, s, groupKey) ? ERC1271_MAGIC : ERC1271_FAIL;
    }

    /// NFTs sent with safeTransferFrom / safeMint call these and revert unless they get the
    /// selector back. Only the manager's execute can move them out again.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    /// ERC-165: itself, the ERC-721 and ERC-1155 receivers, and ERC-1271.
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x150b7a02 || id == 0x4e2312e0 || id == 0x1626ba7e;
    }
}
