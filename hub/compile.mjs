// Compiles the Leash account. The Yul version is what gets deployed (small, cheap);
// LeashAccount.sol is the readable reference with the same ABI and behaviour.
// Output: hub/LeashAccount.json
import solc from 'solc';
import { readFileSync, writeFileSync } from 'node:fs';

const yul = readFileSync(new URL('../contracts/LeashAccount.yul', import.meta.url), 'utf8');
const out = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: 'Yul',
      sources: { 'LeashAccount.yul': { content: yul } },
      settings: { optimizer: { enabled: true, details: { yul: true } }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['evm.bytecode.object', 'evm.deployedBytecode.object'] } } },
    }),
  ),
);
for (const e of out.errors ?? []) console.error(e.formattedMessage);
if ((out.errors ?? []).some((e) => e.severity === 'error')) process.exit(1);
const c = out.contracts['LeashAccount.yul'].LeashAccount;
const abi = [
  { type: 'function', name: 'execute', stateMutability: 'nonpayable', inputs: [
    { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' },
    { name: 'rx', type: 'uint256' }, { name: 's', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'groupKey', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'event', name: 'Executed', inputs: [
    { name: 'nonce', type: 'uint256', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'value', type: 'uint256', indexed: false }] },
];
const init = c.evm.bytecode.object;
const runtime = c.evm.deployedBytecode?.object ?? '';
writeFileSync(new URL('./LeashAccount.json', import.meta.url), JSON.stringify({ abi, bytecode: `0x${init}`, deployed: `0x${runtime}` }, null, 2));
console.log('init bytes', init.length / 2, 'runtime bytes', runtime.length / 2);
