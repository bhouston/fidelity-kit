import { defineConfig } from 'vite';
import { nitroV2Plugin } from '@tanstack/nitro-v2-vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    babel({ presets: [reactCompilerPreset()] }),
    viteReact(),
    nitroV2Plugin({
      preset: 'node-server',
      compatibilityDate: '2025-11-07',
      compressPublicAssets: { gzip: true, brotli: false },
      routeRules: {
        '/assets/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
      },
    }),
  ],
});
