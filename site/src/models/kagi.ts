import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Photo-referenced card enclosure, in mm. Parts use portrait construction coordinates;
// the root turns 90 degrees so the exported device is horizontal, with its button on the right.
// A generic board layout, not the dimensions of a specific development board.
export type KagiTextures = { event?: THREE.Texture; japan?: THREE.Texture; screen?: THREE.Texture };
export function createKagiModel(textures: KagiTextures = {}) {
  const root = new THREE.Group();
  root.name = 'Kagi Wallet — horizontal business-card prototype';
  root.rotation.z = Math.PI / 2;
  const materials = {
    shell: new THREE.MeshStandardMaterial({ color: '#eee8dc', roughness: 0.95 }),
    event: new THREE.MeshStandardMaterial({ color: textures.event ? '#ffffff' : '#29263f', map: textures.event ?? null, roughness: 0.85, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    japan: new THREE.MeshStandardMaterial({ color: textures.japan ? '#ffffff' : '#66a5d8', map: textures.japan ?? null, roughness: 0.8, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    tape: new THREE.MeshPhysicalMaterial({ color: '#dce1df', transparent: true, opacity: 0.18, roughness: 0.3, clearcoat: 0.5, depthWrite: false, side: THREE.FrontSide }),
    blackTape: new THREE.MeshStandardMaterial({ color: '#16191d', roughness: 0.68, side: THREE.DoubleSide }),
    lcd: new THREE.MeshBasicMaterial({ map: textures.screen ?? null, color: textures.screen ? '#ffffff' : '#e4eaf0', toneMapped: false }),
    dark: new THREE.MeshStandardMaterial({ color: '#111c28', roughness: 0.55 }),
    silver: new THREE.MeshStandardMaterial({ color: '#c1cbd1', metalness: 0.75, roughness: 0.3 }),
    pcb: new THREE.MeshStandardMaterial({ color: '#167c62', roughness: 0.65 }),
    charger: new THREE.MeshStandardMaterial({ color: '#2452a0', roughness: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d6ae58', metalness: 0.65, roughness: 0.4 }),
    screen: new THREE.MeshStandardMaterial({ color: '#101f32', roughness: 0.2, metalness: 0.15 }),
    white: new THREE.MeshStandardMaterial({ color: '#e8f3f9', roughness: 0.45 }),
    glow: new THREE.MeshStandardMaterial({ color: '#82d8ff', emissive: '#489ecb', emissiveIntensity: 0.7 }),
    red: new THREE.MeshStandardMaterial({ color: '#c9583e', roughness: 0.6 }),
    lens: new THREE.MeshStandardMaterial({ color: '#9eafcf', metalness: 0.2, roughness: 0.12 }),
  };
  type Finish = keyof typeof materials;
  function layer(name: string) { const group = new THREE.Group(); group.name = name; root.add(group); return group; }
  function box(parent: THREE.Group, name: string, size: number[], pos: number[], finish: Finish, radius = 0.25) {
    const geometry = new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(radius, Math.min(...size) / 2));
    const mesh = new THREE.Mesh(geometry, materials[finish]);
    mesh.name = name; mesh.position.set(pos[0], pos[1], pos[2]); parent.add(mesh); return mesh;
  }
  function tapeFilm(parent: THREE.Group, name: string, w: number, h: number, pos: number[], angleY = 0) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), materials.tape);
    mesh.name = name; mesh.position.set(...pos as [number, number, number]);
    mesh.rotation.y = angleY; mesh.renderOrder = 2; parent.add(mesh); return mesh;
  }
  function wire(parent: THREE.Group, name: string, points: number[][], finish: Finish, radius = 0.18) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, radius, 6, false), materials[finish]);
    mesh.name = name; parent.add(mesh);
  }
  // Small mesh lettering exports cleanly to GLB without external fonts or textures.
  const glyphs: Record<string, string[]> = {
    K:['101','110','100','110','101'], A:['010','101','111','101','101'], G:['111','100','101','101','111'], I:['111','010','010','010','111'],
    E:['111','100','110','100','111'], S:['111','100','111','001','111'], P:['110','101','110','100','100'],
    '3':['111','001','111','001','111'], '2':['111','001','111','100','111'], B:['110','101','110','101','110'],
    T:['111','010','010','010','010'], U:['101','101','101','101','111'], R:['110','101','110','101','101'],
    X:['101','101','010','101','101'], '+':['000','010','111','010','000'], '-':['000','000','111','000','000'],
  };
  function lettering(parent: THREE.Group, text: string, pos: number[], pixel: number, finish: Finish) {
    const cells: THREE.BufferGeometry[] = [];
    [...text].forEach((letter, index) => glyphs[letter]?.forEach((row, y) => [...row].forEach((bit, x) => {
      if (bit === '1') cells.push(new THREE.BoxGeometry(pixel * 0.84, pixel * 0.84, 0.06).translate((index * 4 + x - text.length * 2 + 0.5) * pixel, (2 - y) * pixel, 0));
    })));
    const mesh = new THREE.Mesh(mergeGeometries(cells), materials[finish]);
    cells.forEach(cell => cell.dispose()); mesh.position.set(...pos as [number, number, number]); mesh.name = `${text} marking`; parent.add(mesh);
  }
  // Map the supplied photos onto card planes using their photographed corner UVs.
  // This samples only the card, without inventing or repainting its artwork.
  const cardCorners = {
    event: [[381 / 1368, 425 / 1824], [898 / 1368, 422 / 1824], [902 / 1368, 1271 / 1824], [307 / 1368, 1272 / 1824]],
    japan: [[318 / 899, 562 / 1599], [585 / 899, 562 / 1599], [598 / 899, 986 / 1599], [285 / 899, 983 / 1599]],
  };
  function card(parent: THREE.Group, name: string, w: number, h: number, x: number, y: number, z: number, art: 'event' | 'japan', full = false) {
    const geometry = new THREE.PlaneGeometry(w, h, 10, 16);
    const positions = geometry.attributes.position, uv = geometry.attributes.uv;
    const [tl, tr, br, bl] = cardCorners[art];
    for (let i = 0; i < positions.count; i++) {
      const u = full ? (positions.getX(i) / w + 0.5) : (positions.getX(i) + x + 12) / 24;
      const v = full ? (0.5 - positions.getY(i) / h) : (24 - positions.getY(i) - y) / 48;
      const px = (tl[0] * (1 - u) + tr[0] * u) * (1 - v) + (bl[0] * (1 - u) + br[0] * u) * v;
      const py = (tl[1] * (1 - u) + tr[1] * u) * (1 - v) + (bl[1] * (1 - u) + br[1] * u) * v;
      uv.setXY(i, px, 1 - py);
    }
    const mesh = new THREE.Mesh(geometry, materials[art]); mesh.name = name;
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  function cardStrip(parent: THREE.Group, name: string, size: number[], pos: number[]) {
    box(parent, name + ' · exposed paper edge', [size[0], size[1], 0.35], pos, 'shell', 0.08);
    card(parent, name + ' · ETHConf print', size[0], size[1], pos[0], pos[1], pos[2] + 0.28, 'event');
  }
  const rear = layer('01 · Folded Japan card and tape');
  box(rear, 'Japan card backing · paper edge', [24, 48, 0.4], [0, 0, -6.8], 'shell', 0.14);
  card(rear, 'Japan artwork · inside face', 23.8, 47.8, 0, 0, -6.48, 'japan');
  const backPrint = card(rear, 'Japan artwork · outer back', 23.8, 47.8, 0, 0, -7.12, 'japan');
  backPrint.rotation.y = Math.PI;
  for (const side of [-1, 1]) {
    box(rear, 'Folded card side · paper edge', [0.4, 48, 13], [side * 11.85, 0, -0.4], 'shell', 0.13);
    const sidePrint = card(rear, 'ETHConf folded side', 13, 48, side * 12.17, 0, -0.4, 'event', true);
    sidePrint.rotation.y = side * Math.PI / 2;
    box(rear, 'Black tape along rear seam', [2.4, 48.5, 0.25], [side * 10.7, 0, -7.16], 'blackTape', 0.1);
    box(rear, 'Black tape along front seam', [0.35, 47.6, 2.1], [side * 12.16, 0, 5.3], 'blackTape', 0.1);
    tapeFilm(rear, 'Clear tape over card fold', 12.8, 6, [side * 12.35, -11, -0.4], side * Math.PI / 2);
  }
  // Open ends show the stack, headers and charging socket, as in the photos.
  box(rear, 'Exposed black board support', [21.5, 44, 1.4], [0, 0, -5.8], 'dark');
  for (const x of [-7.5, 7.5]) {
    box(rear, 'Exposed end header', [6, 2.8, 5.2], [x, 23, -1.8], 'dark', 0.15);
    for (let n = 0; n < 2; n++) box(rear, 'Header socket', [1.4, 0.12, 1.4], [x - 1.5 + n * 3, 24.45, -1.6], 'blackTape', 0.05);
  }
  const battery = layer('02 · Rechargeable battery');
  box(battery, 'LiPo pouch cell', [18, 27, 3.6], [0, -1, -3.5], 'silver', 0.7);
  box(battery, 'Battery insulation', [18.2, 3, 3.7], [0, 11, -3.5], 'gold');
  box(battery, 'Battery label', [13, 16, 0.08], [0, -1, -1.65], 'white', 0.02);
  lettering(battery, 'BAT', [0, 2, -1.55], 0.8, 'dark');
  lettering(battery, '+ -', [0, -4, -1.55], 0.6, 'dark');
  wire(battery, 'Battery positive lead', [[-6,11,-3],[-8,14,-2],[-9,-8,-2],[-7,-17,-1]], 'red');
  wire(battery, 'Battery negative lead', [[6,11,-3],[8,14,-2],[9,-8,-2],[7,-17,-1]], 'dark');

  const board = layer('03 · Generic ESP32 board');
  box(board, 'ESP32 PCB', [20, 32, 0.9], [0, 4, -0.7], 'pcb');
  box(board, 'ESP32 RF shield', [11, 12, 1.8], [0, 6, 0.65], 'silver');
  lettering(board, 'ESP32', [0, 6, 1.61], 0.45, 'dark');
  box(board, 'Antenna keepout', [10, 6, 0.15], [0, 16, -0.15], 'dark');
  for (let i = 0; i < 4; i++) {
    box(board, 'Antenna trace', [7, 0.3, 0.12], [0, 14 + i, 0], 'gold', 0.04);
    box(board, 'Antenna return', [0.3, 1, 0.12], [i % 2 ? -3.5 : 3.5, 14.5 + i, 0], 'gold', 0.04);
  }
  for (const x of [-8.5, 8.5]) for (let i = 0; i < 12; i++) {
    box(board, 'Castellated GPIO pad', [1.4, 1.4, 0.14], [x, -10 + i * 2.5, -0.18], 'gold', 0.06);
    box(board, 'GPIO solder point', [0.6, 0.6, 0.2], [x, -10 + i * 2.5, -0.06], 'silver', 0.06);
  }
  box(board, '6-axis IMU', [3.2, 3.2, 1], [-4.5, -4, 0.25], 'dark');
  box(board, 'Temperature sensor', [2, 2, 0.8], [4.5, -4, 0.15], 'dark');
  box(board, 'Ambient light sensor', [2, 2, 0.8], [-5, 16, 0.15], 'dark');
  for (let i = 0; i < 9; i++) box(board, i % 2 ? 'SMT resistor' : 'SMT capacitor', [1.5, 0.7, 0.6], [-5 + (i % 3) * 5, -7 - Math.floor(i / 3) * 1.5, 0.1], i % 2 ? 'dark' : 'gold', 0.1);

  const charger = layer('04 · USB-C charging circuit');
  box(charger, 'Charging PCB', [18, 9, 0.8], [0, -18, -0.7], 'charger');
  box(charger, 'Battery charge controller', [4, 3, 1], [-4, -17, 0.2], 'dark');
  box(charger, 'Battery protection IC', [2.5, 2, 0.7], [4, -17, 0.05], 'dark');
  for (let i = 0; i < 6; i++) box(charger, 'Charger SMT component', [1.1, 0.6, 0.6], [-6 + i * 2.4, -20, 0], i % 2 ? 'dark' : 'gold', 0.08);
  box(charger, 'USB-C charging port surround', [8, 3.8, 2.5], [0, -23, 0.15], 'silver');
  box(charger, 'USB-C opening', [6.8, 0.2, 1.7], [0, -24.94, 0.15], 'dark');
  box(charger, 'USB-C tongue', [5.3, 0.25, 0.4], [0, -25.05, 0.15], 'gold', 0.1);
  box(charger, 'Charge status LED', [0.8, 0.8, 0.3], [7, -16, 0], 'glow', 0.1);
  lettering(charger, '+ -', [0, -14.5, -0.2], 0.4, 'white');

  const front = layer('05 · Cut ETHConf card and front switch');
  cardStrip(front, 'Hand-cut left card rail', [2.7, 48], [-10.65, 0, 6.5]);
  cardStrip(front, 'Hand-cut right card rail', [2.7, 48], [10.65, 0, 6.5]);
  cardStrip(front, 'Card above display', [19, 3.1], [0, 22.45, 6.5]);
  cardStrip(front, 'ETHConf card button panel', [19, 15.4], [0, -16.3, 6.5]);
  // Clear tape overlaps the printed card, with narrow reflective crease lines.
  for (const x of [-9.4, 9.4]) {
    tapeFilm(front, 'Clear tape on screen edge', 2.2, 37, [x, 4, 6.96]);
    tapeFilm(front, 'Tape crease', 0.12, 34, [x + 0.4, 4, 7.03]);
  }
  tapeFilm(front, 'Clear tape across button panel', 23.6, 3, [0, -10.2, 6.96]);
  box(front, 'Front confirmation button', [11.2, 10.4, 3.2], [0, -16, 8.3], 'dark', 0.35);
  box(front, 'Tactile switch metal plate', [9.5, 8.9, 0.35], [0, -16, 10.02], 'silver', 0.25);
  const button = new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.25, 1.65, 40), materials.dark);
  button.name = 'Round black button cap'; button.rotation.x = Math.PI / 2; button.position.set(0, -16, 10.9); front.add(button);
  for (const x of [-3.7, 3.7]) for (const y of [-19.2, -12.8]) {
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.65, 12, 8), materials.dark);
    rivet.name = 'Switch corner rivet'; rivet.scale.z = 0.4; rivet.position.set(x, y, 10.25); front.add(rivet);
  }

  const display = layer('06 · Original Kagi display UI');
  box(display, 'Display backing PCB', [19.4, 29.5, 0.65], [0, 5.5, 5.4], 'dark');
  box(display, 'Display bezel', [19, 29.5, 1.3], [0, 5.5, 6.5], 'dark', 0.2);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(28.444444, 16), materials.lcd);
  screen.name = 'Original 240 × 135 Kagi UI';
  screen.rotation.z = -Math.PI / 2; screen.position.set(0, 5.5, 7.4); display.add(screen);
  box(display, 'Display flex cable', [5, 6, 0.15], [0, -12, 5.4], 'gold', 0.05);
  tapeFilm(display, 'Silver tape over display connector', 7, 3, [0, 21, 7.4]);

  const controls = layer('07 · Top and boot buttons');
  box(controls, 'Top button', [1.5, 6, 4], [12.65, -1, 2], 'red', 0.15);
  box(controls, 'Left bottom boot button', [1.5, 4.5, 3.5], [-12.65, -16, 1.5], 'red', 0.15);
  wire(controls, 'Exposed red jumper loop', [[-6,-22,0],[-8,-30,-1],[-5,-36,-2],[5,-33,-2],[6,-23,-1]], 'red', 0.48);
  wire(controls, 'Exposed black jumper loop', [[7,-22,-2],[9,-32,-2],[4,-38,-3],[-4,-33,-3],[-4,-22,-2]], 'dark', 0.48);
  for (const x of [-6, -4, 6, 7]) box(controls, 'Jumper connector', [1.8, 3.5, 2], [x, -24, -1], 'dark', 0.15);

  const infrared = layer('08 · IR transmitter and receiver');
  box(infrared, 'IR daughterboard', [8, 3, 0.7], [5, 20.8, 1], 'pcb');
  // LED cylinder and domed tip face out of the top edge (+Y).
  const sender = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.5, 20), materials.lens);
  sender.name = 'IR transmitter LED'; sender.position.set(2.8, 23, 1.5); infrared.add(sender);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), materials.lens);
  dome.name = 'IR transmitter lens'; dome.position.set(2.8, 24.25, 1.5); infrared.add(dome);
  box(infrared, 'IR receiver', [3, 3.2, 2.7], [7, 23, 1.5], 'dark', 0.65);
  for (const x of [2.3, 3.3, 6, 7, 8]) box(infrared, 'IR component lead', [0.25, 3, 0.25], [x, 20.5, 1.5], 'silver', 0.03);
  lettering(infrared, 'TX', [2.5, 20, 1.42], 0.25, 'white');
  lettering(infrared, 'RX', [7, 20, 1.42], 0.25, 'white');
  const parts = { rear, battery, board, charger, front, display, controls, infrared };
  return { root, parts, layers: Object.values(parts) };
}
