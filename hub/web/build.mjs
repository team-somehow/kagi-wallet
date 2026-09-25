// Bundles the web chat (chat.js) for the browser with esbuild. Runs when the hub starts.
import { build } from 'esbuild';

export async function buildChat() {
  await build({
    entryPoints: [new URL('./chat.js', import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    outfile: new URL('./dist/chat.js', import.meta.url).pathname,
    logLevel: 'error',
  });
}
