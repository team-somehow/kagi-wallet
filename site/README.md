# Kagi site

The landing page. Vite + React + TypeScript, static output, no server.

```sh
npm install
npm run dev       # http://localhost:5173
npm run build     # static files in dist/
npm run preview   # serve dist/ locally
```

## Deploy

Any static host works. The build uses relative paths, so it also runs from a subfolder.

| Host | Settings |
|---|---|
| Vercel | Root directory `site`, framework preset Vite (build `npm run build`, output `dist`) |
| Netlify | Base directory `site`, build `npm run build`, publish `site/dist` |
| Cloudflare Pages | Root directory `site`, build `npm run build`, output `dist` |

Every figure on the page and its source lives in `src/data.ts`.

### 3D wallet concept

The Hardware section uses a sticky, scroll-driven 3D story, inspired by
[ETH Arcade](https://github.com/team-somehow/eth-arcade). Four chapters rotate the
horizontal wallet, reveal its controls, open the enclosure, and separate its electronics.
The opened assembly turns about 86 degrees and fans its component faces toward
the viewer. The assembled screen remains landscape, with the round switch on the right.
Scroll backward to reassemble it, or use the keyboard-accessible chapter buttons.
Reduced-motion preferences switch directly between static chapter poses.
Rendering pauses outside the section and while the page is hidden.

The enclosure is nominally 48 × 24 × 15 mm; buttons and ports protrude. The generic
compact ESP32 board and component placement are illustrative, not a verified
bill of materials or the dimensions of a specific development kit.

- Geometry: `src/models/kagi.ts` (millimetres, portrait construction coordinates,
  root rotated 90° into landscape).
- Scroll poses: `src/models/kagiMotion.ts`.
- Download: `public/models/kagi-wallet.glb` (glTF metres, eight named part groups).
- Regenerate geometry and the shared screen texture: `npm run model:export` (Node 22.6+).
- Check the motion and model: `npm run model:check`.
- Parts: front/rear shell, display, three buttons, ESP32 PCB with antenna and
  IMU/temperature/light sensors, LiPo battery with leads, separate USB-C charging
  and protection circuit, and distinct infrared transmitter LED and receiver.

Exterior materials come from the supplied ETHConf business-card and Japan-card
photos under `public/models/materials/`. Their card regions are selected by UV
coordinates; the photo files are preserved. The model includes paper edges,
clear and black tape, red tabs, exposed end headers, and wire loops.

The display texture is generated from `DeviceScreen` in `src/components/Device.tsx`,
the same SVG renderer used by the other page devices, with the existing
`lockup.png` and the home state “No agent keys yet”. Do not independently redesign
the model screen. Run `model:export` after changing the shared UI. The GLB embeds
both photo textures and the screen so it is self-contained.
