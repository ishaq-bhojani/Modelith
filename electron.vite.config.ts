import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('src/main/index.ts'), external: ['electron'] } } },
  preload: { build: { rollupOptions: { input: resolve('src/preload/index.ts'), external: ['electron'] } } },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})
