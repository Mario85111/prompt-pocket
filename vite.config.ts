import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  // Zasoby jako osobne pliki, nie data: URI — CSP w index.html dopuszcza tylko 'self'.
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
});
