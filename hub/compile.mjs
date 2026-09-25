// Builds the contracts with Foundry (contracts/, `forge build`) and copies what the hub needs
// into hub/LeashAccount.json and hub/RootTreasury.json as { abi, bytecode, deployed }.
// Constructor arguments are appended to `bytecode` at deploy time (see evm.mjs).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const contracts = new URL('../contracts/', import.meta.url);
execFileSync('forge', ['build'], { cwd: contracts, stdio: 'inherit' });

for (const name of ['LeashAccount', 'RootTreasury']) {
  const a = JSON.parse(readFileSync(new URL(`out/${name}.sol/${name}.json`, contracts), 'utf8'));
  const art = { abi: a.abi, bytecode: a.bytecode.object, deployed: a.deployedBytecode.object };
  writeFileSync(new URL(`./${name}.json`, import.meta.url), JSON.stringify(art, null, 2));
  console.log(name, 'init bytes', (art.bytecode.length - 2) / 2, 'runtime bytes', (art.deployed.length - 2) / 2);
}
