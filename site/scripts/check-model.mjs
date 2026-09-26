import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Device, DeviceScreen } from '../src/components/Device.tsx';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createKagiModel } from '../src/models/kagi.ts';
import { CHAPTER_STOPS, kagiPose } from '../src/models/kagiMotion.ts';

// Scroll contracts: stay closed through controls, open fully inside, reversible
// and continuous at chapter boundaries, with clamped out-of-range positions.
assert.equal(kagiPose(CHAPTER_STOPS[1]).open, 0);
assert.equal(kagiPose(CHAPTER_STOPS[2]).open, 1);
assert.equal(kagiPose(1).power, 1);
assert.deepEqual(kagiPose(-1), kagiPose(0));
assert.deepEqual(kagiPose(2), kagiPose(1));
CHAPTER_STOPS.forEach(stop => assert.equal(kagiPose(stop).rotation[2], Math.PI / 2, 'The device must stay horizontal')); 
let last = 0;
for (let i = 0; i <= 200; i++) {
  const pose = kagiPose(i / 200);
  assert.ok(pose.open >= last && pose.open - last < 0.03, 'Opening must be smooth and monotonic');
  last = pose.open;
}
CHAPTER_STOPS.forEach((stop, index) => assert.equal(kagiPose(stop).chapter, index));

const { root, parts } = createKagiModel();
assert.equal(Object.keys(parts).length, 8);
root.updateMatrixWorld(true);
const shell = new THREE.Box3().setFromObject(parts.rear).getSize(new THREE.Vector3());
assert.ok(shell.x > 48 && shell.x < 50 && shell.y > 24 && shell.y < 26, 'Landscape card body proportions');
const button = root.getObjectByName('Front confirmation button').getWorldPosition(new THREE.Vector3());
const screen = root.getObjectByName('Original 240 × 135 Kagi UI');
assert.ok(button.x > screen.getWorldPosition(new THREE.Vector3()).x, 'Button must be right of display');
const baseline = new THREE.Vector3(1, 0, 0).applyQuaternion(screen.getWorldQuaternion(new THREE.Quaternion()));
assert.ok(baseline.x > 0.999 && Math.abs(baseline.y) < 0.001, 'Display UI must be upright landscape');
const names = ['IR transmitter LED', 'IR receiver', 'ESP32 PCB', 'Battery charge controller', 'Battery protection IC', 'LiPo pouch cell', 'Front confirmation button', 'Top button', 'Left bottom boot button'];
names.forEach(name => assert.ok(root.getObjectByName(name), `${name} missing`));
root.traverse(object => {
  if (!object.isMesh) return;
  for (const coordinate of object.geometry.attributes.position.array) assert.ok(Number.isFinite(coordinate), `${object.name}: invalid vertex`);
});
const buffer = readFileSync(new URL('../public/models/kagi-wallet.glb', import.meta.url));
assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
assert.equal(buffer.readUInt32LE(4), 2);
assert.equal(buffer.readUInt32LE(8), buffer.length);
const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)));
names.forEach(name => assert.ok(gltf.nodes.some(node => node.name === name), `${name} missing from GLB`));
assert.ok(gltf.nodes.some(node => node.matrix && [0, 4, 8].every(i => Math.abs(Math.hypot(...node.matrix.slice(i, i + 3)) - 0.001) < 1e-9)), 'GLB must use metres');
assert.equal(gltf.images.length, 3, 'GLB must embed both cards and the original screen');
console.log(`Verified scroll poses, 8 part groups, ${gltf.meshes.length} meshes, component names, geometry and GLB scale.`);

// The rasterized screen source must remain identical to the shared page UI.
const screenState = { kind: 'home', line: 'No agent keys yet' };
const lockup = readFileSync(new URL('../public/lockup.png', import.meta.url));
const expectedSvg = renderToStaticMarkup(createElement(DeviceScreen, {
  screen: screenState, variant: 'blue', lockupHref: `data:image/png;base64,${lockup.toString('base64')}`,
})).replace('<svg ', '<svg width="960" height="540" ');
assert.equal(readFileSync(new URL('../public/models/materials/kagi-screen.svg', import.meta.url), 'utf8'), expectedSvg);
for (const screen of [screenState, { kind: 'status', top: 'Ready', big: 'Kagi', sub: 'Connected' }, { kind: 'prompt', title: 'Approve', amount: '5', line1: 'Transfer', hold: 0.5 }]) {
  const deviceSvg = renderToStaticMarkup(createElement(Device, { screen })).match(/<svg[\s\S]*?<\/svg>/)[0];
  assert.equal(deviceSvg, renderToStaticMarkup(createElement(DeviceScreen, { screen })));
}
const yawChange = Math.abs(kagiPose(CHAPTER_STOPS[2]).rotation[1] - kagiPose(CHAPTER_STOPS[1]).rotation[1]);
assert.ok(yawChange > 1.4 && yawChange < 1.65, 'Opened assembly should turn roughly 90 degrees');
assert.equal(root.getObjectByName('Clear tape on screen edge').geometry.type, 'PlaneGeometry');
assert.equal(root.getObjectByName('Hand-cut left card rail · ETHConf print').material.side, THREE.FrontSide);
console.log('Verified original shared screen UI, landscape orientation, card surfaces, and ~90° interior turn.');
