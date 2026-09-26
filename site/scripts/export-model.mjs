import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createCanvas, loadImage, Image } from '@napi-rs/canvas';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createKagiModel } from '../src/models/kagi.ts';
import { DeviceScreen } from '../src/components/Device.tsx';

const directory = new URL('../public/models/', import.meta.url);
await mkdir(directory, { recursive: true });
// Render the exact shared page SVG, including its existing lockup image, to a
// texture. The 3D model does not redraw or reinterpret the display UI.
const lockup = await readFile(new URL('../public/lockup.png', import.meta.url));
const svg = renderToStaticMarkup(createElement(DeviceScreen, {
  screen: { kind: 'home', line: 'No agent keys yet' },
  variant: 'blue', lockupHref: `data:image/png;base64,${lockup.toString('base64')}`,
})).replace('<svg ', '<svg width="960" height="540" ');
await writeFile(new URL('materials/kagi-screen.svg', directory), svg);
const screenCanvas = createCanvas(960, 540);
screenCanvas.getContext('2d').drawImage(await loadImage(Buffer.from(svg)), 0, 0, 960, 540);
// The native SVG rasterizer omits embedded bitmap <image> nodes. Composite the
// existing image using the coordinates from that same SVG, without redrawing it.
const imageTag = svg.match(/<image[^>]+>/)?.[0];
if (!imageTag) throw new Error('Shared UI is missing its lockup image');
const imageCoordinate = name => Number(imageTag.match(new RegExp(`${name}="([^"]+)"`))[1]) * 4;
screenCanvas.getContext('2d').drawImage(await loadImage(lockup), imageCoordinate('x'), imageCoordinate('y'), imageCoordinate('width'), imageCoordinate('height'));
await writeFile(new URL('materials/kagi-screen.png', directory), screenCanvas.toBuffer('image/png'));

globalThis.document = { createElement: () => createCanvas(1, 1) };
globalThis.HTMLCanvasElement = createCanvas(1, 1).constructor;
globalThis.HTMLImageElement = Image;
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); });
  }
};
async function texture(filename) {
  const image = await loadImage(await readFile(new URL(`materials/${filename}`, directory)));
  const result = new THREE.Texture(image); result.colorSpace = THREE.SRGBColorSpace; result.needsUpdate = true; return result;
}
const textures = { event: await texture('ethconf-card-photo.jpg'), japan: await texture('japan-card-photo.jpg'), screen: await texture('kagi-screen.png') };
const { root } = createKagiModel(textures);
root.scale.setScalar(0.001); // glTF units are metres.
const glb = await new GLTFExporter().parseAsync(root, { binary: true, maxTextureSize: 2048 });
await writeFile(new URL('kagi-wallet.glb', directory), Buffer.from(glb));
console.log(`Exported horizontal Kagi Wallet with embedded photo and original UI textures (${glb.byteLength} bytes)`);
