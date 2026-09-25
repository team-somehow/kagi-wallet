// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Bip340} from "../src/Bip340.sol";
import {SchnorrTest} from "./utils/Schnorr.sol";

contract Bip340Harness {
    function verify(bytes32 m, uint256 rx, uint256 s, uint256 px) external view returns (bool) {
        return Bip340.verify(m, rx, s, px);
    }
}

contract Bip340Test is SchnorrTest {
    struct Vector {
        uint256 px;
        bytes32 m;
        uint256 rx;
        uint256 s;
        bool ok;
    }

    Bip340Harness h;
    Vector[] v;

    function setUp() public {
        h = new Bip340Harness();
        // Official vectors from bitcoin/bips bip-0340/test-vectors.csv, the 32-byte-message ones.
        v.push(
            Vector(
                0xF9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9,
                0x0000000000000000000000000000000000000000000000000000000000000000,
                0xE907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA8215,
                0x25F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0,
                true
            )
        ); // 0
        v.push(
            Vector(
                0xDFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,
                0x243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,
                0x6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE3341,
                0x8906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A,
                true
            )
        ); // 1
        v.push(
            Vector(
                0xDD308AFEC5777E13121FA72B9CC1B7CC0139715309B086C960E18FD969774EB8,
                0x7E2D58D8B3BCDF1ABADEC7829054F90DDA9805AAB56C77333024B9D0A508B75C,
                0x5831AAEED7B44BB74E5EAB94BA9D4294C49BCF2A60728D8B4C200F50DD313C1B,
                0xAB745879A5AD954A72C45A91C3A51D3C7ADEA98D82F8481E0E1E03674A6F3FB7,
                true
            )
        ); // 2
        v.push(
            Vector(
                0x25D1DFF95105F5253C4022F628A996AD3A0D95FBF21D468A1B33F8C160D8F517,
                0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF,
                0x7EB0509757E246F19449885651611CB965ECC1A187DD51B64FDA1EDC9637D5EC,
                0x97582B9CB13DB3933705B32BA982AF5AF25FD78881EBB32771FC5922EFC66EA3,
                true
            )
        ); // 3: test fails if msg is reduced modulo p or n
        v.push(
            Vector(
                0xD69C3509BB99E412E68B0FE8544E72837DFA30746D8BE2AA65975F29D22DC7B9,
                0x4DF3C3F68FCC83B27E9D42C90431A72499F17875C81A599B566C9889B9696703,
                0x00000000000000000000003B78CE563F89A0ED9414F5AA28AD0D96D6795F9C63,
                0x76AFB1548AF603B3EB45C9F8207DEE1060CB71C04E80F593060B07D28308D7F4,
                true
            )
        ); // 4
        v.push(
            Vector(
                0xEEFDEA4CDB677750A420FEE807EACF21EB9898AE79B9768766E4FAA04A2D4A34,
                0x243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,
                0x6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E177769,
                0x69E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B,
                false
            )
        ); // 5: public key not on the curve
        v.push(
            Vector(
                0xDFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,
                0x243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,
                0xFFF97BD5755EEEA420453A14355235D382F6472F8568A18B2F057A1460297556,
                0x3CC27944640AC607CD107AE10923D9EF7A73C643E166BE5EBEAFA34B1AC553E2,
                false
            )
        ); // 6: has_even_y(R) is false
        v.push(
            Vector(
                0xDFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,
                0x243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,
                0x1FA62E331EDBC21C394792D2AB1100A7B432B013DF3F6FF4F99FCB33E0E1515F,
                0x28890B3EDB6E7189B630448B515CE4F8622A954CFE545735AAEA5134FCCDB2BD,
                false
            )
        ); // 7: negated message
        v.push(
            Vector(
                0xDFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,
                0x243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,
                0x6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E177769,
                0x961764B3AA9B2FFCB6EF947B6887A226E8D7C93E00C5ED0C1834FF0D0C2E6DA6,
                false
            )
        ); // 8: negated s value
        v.push(
            Vector(
                0xDFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,
                0x243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,
                0x0000000000000000000000000000000000000000000000000000000000000000,
                0x123DDA8328AF9C23A94C1FEECFD123BA4FB73476F0D594DCB65C6425BD186051,
                false
            )
        ); // 9: sG - eP is infinite
        v.push(
            Vector(
                0xDFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,
                0x243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,
                0x0000000000000000000000000000000000000000000000000000000000000001,
                0x7615FBAF5AE28864013C099742DEADB4DBA87F11AC6754F93780D5A1837CF197,
                false
            )
        ); // 10: sG - eP is infinite
        v.push(
            Vector(
                0xDFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,
                0x243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,
                0x4A298DACAE57395A15D0795DDBFD1DCB564DA82B0F269BC70A74F8220429BA1D,
                0x69E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B,
                false
            )
        ); // 11: sig[0:32] is not an X coordinate on the curve
        v.push(
            Vector(
                0xDFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,
                0x243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,
                0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F,
                0x69E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B,
                false
            )
        ); // 12: sig[0:32] is equal to field size
        v.push(
            Vector(
                0xDFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,
                0x243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,
                0x6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E177769,
                0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141,
                false
            )
        ); // 13: sig[32:64] is equal to curve order
        v.push(
            Vector(
                0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC30,
                0x243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,
                0x6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E177769,
                0x69E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B,
                false
            )
        ); // 14: public key is not a valid X coordinate because it exceeds the field size
    }

    function test_OfficialVectors() public view {
        for (uint256 i; i < v.length; i++) {
            assertEq(h.verify(v[i].m, v[i].rx, v[i].s, v[i].px), v[i].ok, vm.toString(i));
        }
    }

    function testFuzz_SignThenVerify(uint256 d, bytes32 m) public {
        d = bound(d, 1, N - 1);
        (uint256 rx, uint256 s) = schnorrSign(d, m);
        assertTrue(h.verify(m, rx, s, xonly(d)));
    }

    function testFuzz_TamperedFails(uint256 d, bytes32 m, uint8 which, uint256 delta) public {
        d = bound(d, 1, N - 1);
        delta = bound(delta, 1, type(uint128).max);
        (uint256 rx, uint256 s) = schnorrSign(d, m);
        uint256 px = xonly(d);
        which %= 4;
        if (which == 0) m = bytes32(uint256(m) ^ delta);
        else if (which == 1) rx ^= delta;
        else if (which == 2) s ^= delta;
        else px ^= delta;
        assertFalse(h.verify(m, rx, s, px));
    }

    function test_ZeroAndOutOfRangeInputsFail() public view {
        assertFalse(h.verify(bytes32(0), 1, 1, 0));
        assertFalse(h.verify(bytes32(0), 1, 0, 1));
        assertFalse(h.verify(bytes32(0), 1, N, 1));
        assertFalse(h.verify(bytes32(0), type(uint256).max, 1, 1));
    }
}
