import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('src/main/index.ts'), external: ['electron'] } } },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        external: ['electron'],
        // Electron's sandboxed preload loader executes the script as CommonJS
        // regardless of the project's `"type": "module"` — an ESM `import` throws
        // "Cannot use import statement outside a module" at preload-error time,
        // and contextBridge.exposeInMainWorld silently never runs.
        output: { format: 'cjs', entryFileNames: 'index.js' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})
