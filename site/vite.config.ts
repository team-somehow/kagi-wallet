import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base so the build works from any path: Vercel, Netlify, GitHub Pages, or a subfolder.
export default defineConfig({
  base: './',
  plugins: [react()],
});
