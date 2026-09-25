// RootTreasury: a minimal Leash account owned by the 3-of-3 root key (phone + wrist + vault).
// Same call format as LeashAccount.execute, so the same signing code works:
//   execute(address to, uint256 value, bytes data, uint256 rx, uint256 s)   groupKey()   nonce()
//   m = sha256("LEASH/evm" || chainid || this || nonce || to || value || data), BIP340 over m.
// Constructor argument (32 bytes appended to the init code): the root group key x, even y.
object "RootTreasury" {
  code {
    let size := datasize("runtime")
    datacopy(0, dataoffset("runtime"), size)
    codecopy(size, sub(codesize(), 32), 32)
    sstore(1, mload(size))
    return(0, size)
  }
  object "runtime" {
    code {
      if iszero(calldatasize()) { stop() }
      switch shr(224, calldataload(0))
      case 0x9037d9ca { mstore(0, sload(1)) return(0, 32) }
      case 0xaffed0e0 { mstore(0, sload(0)) return(0, 32) }
      case 0xef7b1f62 {
        let to := calldataload(4)
        let value := calldataload(36)
        let off := add(4, calldataload(68))
        let len := calldataload(off)
        let rx := calldataload(100)
        let s := calldataload(132)
        let n := sload(0)
        mstore(0x80, 0x4c454153482f65766d0000000000000000000000000000000000000000000000)
        mstore(0x89, chainid())
        mstore(0xa9, shl(96, address()))
        mstore(0xbd, n)
        mstore(0xdd, shl(96, to))
        mstore(0xf1, value)
        calldatacopy(0x111, add(off, 32), len)
        if iszero(staticcall(gas(), 2, 0x80, add(0x91, len), 0x00, 32)) { revert(0, 0) }
        let m := mload(0x00)
        let P := 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
        let N := 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
        let px := sload(1)
        if or(iszero(lt(rx, P)), or(iszero(s), iszero(lt(s, N)))) { revert(0, 0) }
        let tag := 0x7bb52d7a9fef58323eb1bf7a407db382d2f3f2d81bb1224f49fe518f6d48d37c
        mstore(0x00, tag)
        mstore(0x20, tag)
        mstore(0x40, rx)
        mstore(0x60, px)
        mstore(0x80, m)
        if iszero(staticcall(gas(), 2, 0x00, 0xa0, 0x00, 32)) { revert(0, 0) }
        let e := mod(mload(0x00), N)
        mstore(0x00, sub(N, mulmod(s, px, N)))
        mstore(0x20, 27)
        mstore(0x40, px)
        mstore(0x60, sub(N, mulmod(e, px, N)))
        if iszero(staticcall(gas(), 1, 0x00, 0x80, 0x00, 32)) { revert(0, 0) }
        let q := mload(0x00)
        if iszero(q) { revert(0, 0) }
        let c := addmod(mulmod(mulmod(rx, rx, P), rx, P), 7, P)
        mstore(0x00, 32)
        mstore(0x20, 32)
        mstore(0x40, 32)
        mstore(0x60, c)
        mstore(0x80, 0x3FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFBFFFFF0C)
        mstore(0xa0, P)
        if iszero(staticcall(gas(), 5, 0x00, 0xc0, 0x00, 32)) { revert(0, 0) }
        let ry := mload(0x00)
        if iszero(eq(mulmod(ry, ry, P), c)) { revert(0, 0) }
        if and(ry, 1) { ry := sub(P, ry) }
        mstore(0x00, rx)
        mstore(0x20, ry)
        if iszero(eq(q, and(keccak256(0x00, 0x40), 0xffffffffffffffffffffffffffffffffffffffff))) { revert(0, 0) }
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
      default { revert(0, 0) }
    }
  }
}
