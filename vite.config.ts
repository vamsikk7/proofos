import fs from 'node:fs/promises';
import path from 'node:path';
import { crx } from '@crxjs/vite-plugin';
import { defineConfig, type Plugin } from 'vite';
import zip from 'vite-plugin-zip-pack';
import manifest from './manifest.config.js';
import { name, version } from './package.json';

function removeViteMetadata(outDir: string): Plugin {
  return {
    name: 'remove-vite-metadata',
    closeBundle: async () => {
      await fs.rm(path.resolve(__dirname, outDir, '.vite'), {
        recursive: true,
        force: true,
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  resolve: {
    alias: {
      '@': `${path.resolve(__dirname, 'src')}`,
    },
  },
  build: {
    target: 'esnext',
    outDir: command === 'serve' ? 'dev' : 'dist',
  },
  plugins: [
    crx({ manifest }),
    zip({
      outDir: 'release',
      outFileName: `crx-${name.toLowerCase()}-${version}.zip`,
    }),
    ...(command === 'build' ? [removeViteMetadata('dist')] : []),
  ],
  server: {
    cors: {
      origin: [/chrome-extension:\/\//],
    },
  },
  logLevel: 'info',
}));
