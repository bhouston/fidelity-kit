import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Built into the CLI package (../cli/viewer) so `fidelity-kit serve|build` can ship it.
// For `pnpm dev`, run `fidelity-kit serve <root>` (port 3000) alongside; /data is proxied to it.
export default defineConfig({
  base: './',
  resolve: { tsconfigPaths: true },
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), viteReact(), tailwindcss()],
  server: { proxy: { '/data': 'http://localhost:3000' } },
  build: { outDir: '../cli/viewer', emptyOutDir: true },
});
