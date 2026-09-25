# Leash site

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
