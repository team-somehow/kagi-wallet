import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createKagiModel } from '../models/kagi';
import { CHAPTER_STOPS, clamp, kagiPose } from '../models/kagiMotion';
import './WalletModel.css';

const CHAPTERS = [
  { name: 'The wallet', eyebrow: '01 / A physical boundary', title: 'Small enough to carry.\nBuilt to say yes.', description: 'The actual Kagi prototype: a landscape display, a round black button on the right, and an enclosure made from cards picked up at the event.', specs: [['Enclosure', 'Repurposed printed cards'], ['Interaction', 'Display + three buttons']], foot: 'Scroll to turn it over and look inside.' },
  { name: 'The controls', eyebrow: '02 / In your hands', title: 'Three buttons.\nYou’re in control.', description: 'The raised black switch sits beside the screen. Red side tabs, clear tape, black edge tape, and exposed jumper loops show how the prototype was assembled by hand.', specs: [['Front / right', 'Round confirmation button'], ['Top / lower left', 'Top button / boot button']], foot: 'Keep scrolling. The enclosure is about to open.' },
  { name: 'Inside', eyebrow: '03 / Open it up', title: 'A small board.\nA complete system.', description: 'The cut ETHConf card lifts away from the display. The Japan card forms the back, held together with tape. Inside sit the ESP32, basic sensors, battery, and a separate charging circuit.', specs: [['Front & sides', 'ETHConf business card'], ['Back', 'Japan illustrated card']], foot: 'Repurposed event cards. Their original artwork stays visible in the enclosure.' },
  { name: 'Power + IR', eyebrow: '04 / Power & communication', title: 'Charged by USB.\nConnected by light.', description: 'USB-C feeds the charging and battery-protection circuit. A LiPo cell supplies power. At the top, a separate IR transmitter and receiver provide the two sides of the infrared link.', specs: [['Power', 'LiPo + USB-C charging circuit'], ['Infrared', 'Transmitter LED + receiver']], foot: 'A hardware concept. Component placement and fit are illustrative.' },
] as const;
const CALLOUTS = [
  ['board', 'ESP32 board', 'MCU · antenna · sensors'],
  ['infrared', 'IR transmitter + receiver', 'Separate TX / RX components'],
  ['battery', 'LiPo battery', 'Rechargeable pouch cell'],
  ['charger', 'Charging circuit', 'USB-C · charge · protection'],
  ['front', 'ETHConf card', 'Cut front & folded sides'],
  ['rear', 'Japan card', 'Illustrated card backing'],
] as const;

export default function WalletModel() {
  const story = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const progressBar = useRef<HTMLSpanElement>(null);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const lines = useRef<(SVGLineElement | null)[]>([]);
  const [chapter, setChapter] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const element = host.current!;
    const section = story.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setUnavailable(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xf5faff, 0x738394, 2.8));
    const key = new THREE.DirectionalLight(0xffffff, 3.5); key.position.set(-50, 80, 100); scene.add(key);
    const rim = new THREE.DirectionalLight(0xb6d9ff, 4); rim.position.set(70, 20, -50); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 1); fill.position.set(-60, -40, 50); scene.add(fill);
    const camera = new THREE.PerspectiveCamera(32, 1, 10, 1200);
    const textureLoader = new THREE.TextureLoader();
    const textureFiles = { event: 'ethconf-card-photo.jpg', japan: 'japan-card-photo.jpg', screen: 'kagi-screen.png' };
    const textures = Object.fromEntries(Object.entries(textureFiles).map(([key, file]) => {
      const texture = textureLoader.load(`/models/materials/${file}`);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return [key, texture];
    }));
    const model = createKagiModel(textures); scene.add(model.root);
    const { parts } = model;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 1, height = 1, progress = 0, activeChapter = -1;
    let raf = 0, inView = false, disposed = false;
    let previousTime = 0;
    const boundingBox = new THREE.Box3();
    const sphere = new THREE.Sphere();
    const anchor = new THREE.Vector3();
    const anchors: Record<typeof CALLOUTS[number][0], [number, number, number]> = {
      board: [0, 6, 1.6], infrared: [5, 23, 1.5], battery: [0, -1, -1.5], charger: [0, -18, 1], front: [7, -16, 6.7], rear: [0, 0, -7],
    };
    function targetProgress() {
      const rect = section.getBoundingClientRect();
      const sticky = section.querySelector<HTMLElement>('.wallet-film-sticky')!;
      const top = parseFloat(getComputedStyle(sticky).top) || 0;
      return clamp((top - rect.top) / Math.max(1, section.offsetHeight - sticky.offsetHeight));
    }
    function draw(value: number) {
      const pose = kagiPose(value);
      const o = pose.open, p = pose.power;
      model.root.rotation.set(...pose.rotation);
      parts.rear.position.set(26 * o, -5 * o, -18 * o);
      parts.rear.rotation.set(0.9 * o, Math.PI * o, 0);
      parts.controls.position.copy(parts.rear.position);
      parts.battery.position.set(-27 * o - 3 * p, 8 * o, -5 * o);
      parts.board.position.set(-2 * o, 0, 5 * o);
      parts.charger.position.set(-22 * o - 3 * p, -28 * o, 8 * o);
      parts.infrared.position.set(18 * o, 18 * o + 3 * p, 5 * o);
      parts.front.position.set(2 * o, -23 * o, 23 * o);
      parts.display.position.set(10 * o, 27 * o, 30 * o);
      // Turn the opened assembly ~86 degrees, then fan component faces toward
      // the viewer so the PCB, charger and battery remain inspectable.
      parts.board.rotation.x = 1.1 * o;
      parts.charger.rotation.x = 1.1 * o;
      parts.battery.rotation.x = 1.1 * o;
      parts.display.rotation.x = 0.9 * o;
      parts.front.rotation.x = 0.9 * o;
      parts.infrared.rotation.x = 0.8 * o;
      model.root.updateMatrixWorld(true);
      boundingBox.setFromObject(model.root).getBoundingSphere(sphere);
      const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(16)) * Math.min(camera.aspect, 1));
      camera.position.set(sphere.center.x, sphere.center.y, sphere.center.z + sphere.radius * 1.12 / Math.sin(halfFov));
      camera.lookAt(sphere.center);
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      // Labels remain legible at the stage edges; leader lines track real parts.
      CALLOUTS.forEach(([part], index) => {
        const label = labels.current[index], line = lines.current[index];
        if (!label || !line) return;
        anchor.set(...anchors[part]); parts[part].localToWorld(anchor); anchor.project(camera);
        const x = (anchor.x * 0.5 + 0.5) * width, y = (-anchor.y * 0.5 + 0.5) * height;
        const right = index % 2 === 1;
        const labelX = right ? width - 170 : 12;
        const labelY = (index < 2 || index > 3) ? height * 0.12 : height * 0.84;
        label.style.transform = `translate(${labelX}px, ${labelY}px)`;
        const show = index > 3 ? pose.chapter === 2 : index < 2 ? pose.chapter === 3 : true;
        label.style.opacity = `${show ? clamp((o - 0.55) / 0.45) : 0}`;
        line.setAttribute('x1', `${right ? labelX : labelX + 150}`);
        line.setAttribute('y1', `${labelY + 20}`);
        line.setAttribute('x2', `${x}`); line.setAttribute('y2', `${y}`);
        line.style.opacity = label.style.opacity;
      });
      if (progressBar.current) progressBar.current.style.transform = `scaleX(${value})`;
      section.dataset.open = o > 0.55 ? 'true' : 'false';
    }
    function tick(time: number) {
      raf = 0;
      if (disposed || !inView || document.hidden) return;
      const target = targetProgress();
      const nextChapter = kagiPose(target).chapter;
      if (nextChapter !== activeChapter) { activeChapter = nextChapter; setChapter(nextChapter); }
      const dt = Math.min((time - previousTime) / 1000 || 0.016, 0.1); previousTime = time;
      progress = motion.matches ? CHAPTER_STOPS[nextChapter] : progress + (target - progress) * (1 - Math.exp(-12 * dt));
      draw(progress);
      raf = requestAnimationFrame(tick);
    }
    function start() { if (!raf && inView && !document.hidden) raf = requestAnimationFrame(tick); }
    const resize = new ResizeObserver(() => {
      width = element.clientWidth; height = element.clientHeight;
      renderer.setSize(width, height); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); draw(progress);
    });
    resize.observe(element);
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (inView) start(); else { cancelAnimationFrame(raf); raf = 0; }
    });
    observer.observe(section);
    document.addEventListener('visibilitychange', start);
    const lost = (event: Event) => { event.preventDefault(); setUnavailable(true); cancelAnimationFrame(raf); inView = false; };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    return () => {
      disposed = true; cancelAnimationFrame(raf); observer.disconnect(); resize.disconnect();
      document.removeEventListener('visibilitychange', start);
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      const materials = new Set<THREE.Material>();
      model.root.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
        }
      });
      materials.forEach(material => material.dispose()); Object.values(textures).forEach(texture => texture.dispose()); renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  function goToChapter(index: number) {
    const section = story.current!;
    const sticky = section.querySelector<HTMLElement>('.wallet-film-sticky')!;
    const top = parseFloat(getComputedStyle(sticky).top) || 0;
    const start = window.scrollY + section.getBoundingClientRect().top - top;
    window.scrollTo({ top: start + CHAPTER_STOPS[index] * (section.offsetHeight - sticky.offsetHeight), behavior: 'instant' });
    // The text remains navigable if WebGL is unavailable.
    if (unavailable) setChapter(index);
  }
  const content = CHAPTERS[chapter];
  return (
    <section className="wallet-film" ref={story} aria-label="Explore the Kagi Wallet in 3D">
      <div className="wallet-film-sticky">
        <header className="wallet-film-header"><span>04 / INSIDE KAGI</span><span>01 — 04</span></header>
        <div className="wallet-film-layout">
          <div className="wallet-film-copy" key={chapter}>
            <span className="eyebrow">{content.eyebrow}</span>
            <h3>{content.title.split('\n').map(line => <span key={line}>{line}</span>)}</h3>
            <p>{content.description}</p>
            <dl>{content.specs.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            <p className="wallet-film-foot">{content.foot}</p>
          </div>
          <div className="wallet-film-stage">
            <span className="wallet-film-word" aria-hidden="true">{chapter < 2 ? 'KAGI' : 'INSIDE'}</span>
            <div ref={host} className="wallet-film-canvas" role="img" aria-label={`Kagi 3D model: ${content.name}. ${chapter < 2 ? 'Horizontal handmade card enclosure, original Kagi screen on the left, round black button on the right, taped edges and wire loops.' : 'Separated display, enclosure, ESP32 board, LiPo battery, charging circuit and IR transmitter and receiver.'}`} />
            <svg className="wallet-film-leaders" aria-hidden="true">{CALLOUTS.map(([part], i) => <line key={part} ref={el => { lines.current[i] = el; }} />)}</svg>
            {CALLOUTS.map(([part, title, sub], i) => <div className="wallet-film-callout" aria-hidden="true" key={part} ref={el => { labels.current[i] = el; }}><b>{title}</b><span>{sub}</span></div>)}
            {unavailable && <div className="wallet-film-fallback"><b>Explore the hardware</b><p>3D rendering is unavailable on this device. Use the chapters below or download the model.</p></div>}
          </div>
        </div>
        <footer className="wallet-film-footer">
          <span className="wallet-film-scroll">↓ Scroll to {chapter < 2 ? 'open' : 'explore'}</span>
          <nav className="wallet-film-chapters" aria-label="Hardware chapters">{CHAPTERS.map(({ name }, index) => <button type="button" key={name} aria-current={chapter === index ? 'step' : undefined} onClick={() => goToChapter(index)}><span>0{index + 1}</span>{name}</button>)}</nav>
          <a href="/models/kagi-wallet.glb" download>Download GLB ↗</a>
        </footer>
        <div className="wallet-film-progress" aria-hidden="true"><span ref={progressBar} /></div>
      </div>
    </section>
  );
}
