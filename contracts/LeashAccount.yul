// LeashAccount v2, in Yul so deploying it is cheap.
//
// A smart account with three kinds of signer:
//   manager key  2-of-2 threshold Schnorr (phone + wrist), BIP340. Moves anything, grants keys.
//   phone key    the phone's shard on its own, BIP340. Can only revoke.
//   session key  an agent's ephemeral ECDSA key. Spends plain ETH under its cap until it expires.
//
// ABI
//   execute(address to, uint256 value, bytes data, uint256 rx, uint256 s)            manager
//   grant(address agent, uint256 cap, uint256 expiry, uint256 rx, uint256 s)         manager
//   revoke(address agent, uint256 rx, uint256 s)                                     phone or manager
//   spend(address agent, address to, uint256 value, uint8 v, bytes32 r, bytes32 s)   agent
//   session(address agent) -> (cap, spent, expiry, nonce)
//   groupKey() phoneKey() nonce()        plain ETH transfers are accepted
//
// Signed messages (sha256 for Schnorr, keccak256 for the agent's ECDSA)
//   execute  sha256("LEASH/evm"    || chainid || this || nonce || to || value || data)
//   grant    sha256("LEASH/grant"  || chainid || this || nonce || agent || cap || expiry)
//   revoke   sha256("LEASH/revoke" || chainid || this || nonce || agent)
//   spend    keccak256("LEASH/spend" || chainid || this || agent || sessionNonce || to || value)
// The wrist rebuilds the manager messages itself from what it shows before it signs.
//
// Limits: the cap counts ETH value only, a session can't call contracts or this account,
// and one session lives at most as long as its expiry (so one cap per key lifetime).
//
// Storage: 0 nonce, 1 groupKey, 2 phoneKey, sessions at keccak(agent . 3) + 0..3
// Constructor args (appended to the init code): groupKey x, phoneKey x (both even y).
object "LeashAccount" {
  code {
    let size := datasize("runtime")
    datacopy(0, dataoffset("runtime"), size)
    codecopy(size, sub(codesize(), 64), 64)
    sstore(1, mload(size))
    sstore(2, mload(add(size, 32)))
    return(0, size)
  }
  object "runtime" {
    code {
      if iszero(calldatasize()) { stop() }
      switch shr(224, calldataload(0))
      case 0x9037d9ca { mstore(0, sload(1)) return(0, 32) }  // groupKey()
      case 0xdfd8f55e { mstore(0, sload(2)) return(0, 32) }  // phoneKey()
      case 0xaffed0e0 { mstore(0, sload(0)) return(0, 32) }  // nonce()
      case 0x7aab8588 {                                       // session(address)
        let b := slotOf(calldataload(4))
        mstore(0x00, sload(b))
        mstore(0x20, sload(add(b, 1)))
        mstore(0x40, sload(add(b, 2)))
        mstore(0x60, sload(add(b, 3)))
        return(0, 0x80)
      }
      case 0xef7b1f62 {                                       // execute
        let to := calldataload(4)
        let value := calldataload(36)
        let off := add(4, calldataload(68))
        let len := calldataload(off)
        let n := sload(0)
        let p := head(0x100, "LEASH/evm", 9)
        mstore(p, n)
        mstore(add(p, 32), shl(96, to))
        mstore(add(p, 52), value)
        calldatacopy(add(p, 84), add(off, 32), len)
        let m := sha(0x100, add(sub(p, 0x100), add(84, len)))
        if iszero(schnorr(m, calldataload(100), calldataload(132), sload(1))) { revert(0, 0) }
        sstore(0, add(n, 1))
        mstore(0x00, value)
        log3(0x00, 0x20, 0x12c8907d32b752d626a36cf18f31719e25f1a3b6f750ee948c22c036373d48aa, n, to)
        calldatacopy(0x00, add(off, 32), len)
        if iszero(call(gas(), to, value, 0x00, len, 0, 0)) {
          returndatacopy(0, 0, returndatasize())
          revert(0, returndatasize())
        }
        stop()
      }
      case 0x18ce4d94 {                                       // grant
        let agent := calldataload(4)
        let cap := calldataload(36)
        let expiry := calldataload(68)
        let n := sload(0)
        let p := head(0x100, "LEASH/grant", 11)
        mstore(p, n)
        mstore(add(p, 32), shl(96, agent))
        mstore(add(p, 52), cap)
        mstore(add(p, 84), expiry)
        let m := sha(0x100, add(sub(p, 0x100), 116))
        if iszero(schnorr(m, calldataload(100), calldataload(132), sload(1))) { revert(0, 0) }
        sstore(0, add(n, 1))
        let b := slotOf(agent)
        sstore(b, cap)
        sstore(add(b, 1), 0)
        sstore(add(b, 2), expiry)
        mstore(0x00, cap)
        mstore(0x20, expiry)
        log2(0x00, 0x40, 0x830cad818db7fa43ac6053f645136c5d74a8a18439a8e0ed6735fbddff43fdd6, agent)
        stop()
      }
      case 0x990e4c51 {                                       // revoke
        let agent := calldataload(4)
        let rx := calldataload(36)
        let s := calldataload(68)
        let n := sload(0)
        let p := head(0x100, "LEASH/revoke", 12)
        mstore(p, n)
        mstore(add(p, 32), shl(96, agent))
        let m := sha(0x100, add(sub(p, 0x100), 52))
        // Any single shard can stop a key: the phone alone, or phone and wrist together.
        if iszero(or(schnorr(m, rx, s, sload(2)), schnorr(m, rx, s, sload(1)))) { revert(0, 0) }
        sstore(0, add(n, 1))
        sstore(add(slotOf(agent), 2), 0)
        log2(0, 0, 0xb6fa8b8bd5eab60f292eca876e3ef90722275b785309d84b1de113ce0b8c4e74, agent)
        stop()
      }
      case 0x2e907f69 {                                       // spend
        let agent := calldataload(4)
        let to := calldataload(36)
        let value := calldataload(68)
        let b := slotOf(agent)
        let sn := sload(add(b, 3))
        // keccak256("LEASH/spend" || chainid || this || agent || sessionNonce || to || value)
        let p := head(0x100, "LEASH/spend", 11)
        mstore(p, shl(96, agent))
        mstore(add(p, 20), sn)
        mstore(add(p, 52), shl(96, to))
        mstore(add(p, 72), value)
        let h := keccak256(0x100, add(sub(p, 0x100), 104))
        mstore(0x00, h)
        mstore(0x20, calldataload(100))
        mstore(0x40, calldataload(132))
        mstore(0x60, calldataload(164))
        if iszero(staticcall(gas(), 1, 0x00, 0x80, 0x00, 32)) { revert(0, 0) }
        if iszero(and(iszero(iszero(agent)), eq(mload(0x00), agent))) { fail("bad agent signature") }
        if iszero(gt(sload(add(b, 2)), timestamp())) { fail("key expired or revoked") }
        let spent := add(sload(add(b, 1)), value)
        if gt(spent, sload(b)) { fail("over the cap") }
        if eq(to, address()) { fail("no self calls") }
        sstore(add(b, 1), spent)
        sstore(add(b, 3), add(sn, 1))
        mstore(0x00, value)
        log3(0x00, 0x20, 0xc18352ae46a2296c951b2256c5ebc5b4546e6222fea2e4f36e824db9d44eb7ec, agent, to)
        // Plain ETH only: no calldata, so a session can't approve tokens or call out.
        if iszero(call(gas(), to, value, 0, 0, 0, 0)) { fail("transfer failed") }
        stop()
      }
      default { revert(0, 0) }

      function slotOf(agent) -> b {
        mstore(0x00, agent)
        mstore(0x20, 3)
        b := keccak256(0x00, 0x40)
      }

      // Writes tag || chainid || this at ptr and returns where the next field goes.
      function head(ptr, tag, tagLen) -> next {
        mstore(ptr, tag)
        mstore(add(ptr, tagLen), chainid())
        mstore(add(ptr, add(tagLen, 32)), shl(96, address()))
        next := add(ptr, add(tagLen, 52))
      }

      function sha(ptr, len) -> h {
        if iszero(staticcall(gas(), 2, ptr, len, 0x00, 32)) { revert(0, 0) }
        h := mload(0x00)
      }

      function fail(reason) {
        // Error(string) with a short reason, so the relayer can tell the phone why.
        mstore(0x00, 0x08c379a000000000000000000000000000000000000000000000000000000000)
        mstore(0x04, 0x20)
        mstore(0x24, 32)
        mstore(0x44, reason)
        revert(0x00, 0x64)
      }

      // BIP340 verify of (rx, s) over m for x-only key px. Returns 0 or 1, never reverts.
      // ecrecover(-s*px, 27, px, -e*px) is the address of s*G - e*P; it must be the point (rx, even y).
      function schnorr(m, rx, s, px) -> ok {
        let P := 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
        let N := 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
        if or(iszero(px), or(iszero(lt(rx, P)), or(iszero(s), iszero(lt(s, N))))) { leave }
        let tag := 0x7bb52d7a9fef58323eb1bf7a407db382d2f3f2d81bb1224f49fe518f6d48d37c
        mstore(0x00, tag)
        mstore(0x20, tag)
        mstore(0x40, rx)
        mstore(0x60, px)
        mstore(0x80, m)
        if iszero(staticcall(gas(), 2, 0x00, 0xa0, 0x00, 32)) { leave }
        let e := mod(mload(0x00), N)
        mstore(0x00, sub(N, mulmod(s, px, N)))
        mstore(0x20, 27)
        mstore(0x40, px)
        mstore(0x60, sub(N, mulmod(e, px, N)))
        if iszero(staticcall(gas(), 1, 0x00, 0x80, 0x00, 32)) { leave }
        let q := mload(0x00)
        if iszero(q) { leave }
        let c := addmod(mulmod(mulmod(rx, rx, P), rx, P), 7, P)
        mstore(0x00, 32)
        mstore(0x20, 32)
        mstore(0x40, 32)
        mstore(0x60, c)
        mstore(0x80, 0x3FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFBFFFFF0C)
        mstore(0xa0, P)
        if iszero(staticcall(gas(), 5, 0x00, 0xc0, 0x00, 32)) { leave }
        let ry := mload(0x00)
        if iszero(eq(mulmod(ry, ry, P), c)) { leave }
        if and(ry, 1) { ry := sub(P, ry) }
        mstore(0x00, rx)
        mstore(0x20, ry)
        ok := eq(q, and(keccak256(0x00, 0x40), 0xffffffffffffffffffffffffffffffffffffffff))
      }
    }
  }
}
