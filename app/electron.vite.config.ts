import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), migration: resolve('src/main/migration.ts'), storageImport: resolve('src/main/storage-import.ts'), fingerprintRuntime: resolve('src/main/fingerprint-runtime.ts'), dolaTask: resolve('src/main/dola-task.ts'), doubaoTask: resolve('src/main/doubao-task.ts'), doubaoHistory: resolve('src/main/doubao-history.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          remote: resolve('src/preload/remote.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [tailwindcss(), react()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  }
});
