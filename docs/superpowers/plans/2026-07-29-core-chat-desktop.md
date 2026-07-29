# Open Coder Core Chat Desktop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hardened Electron desktop app that streams chat from any of three model providers, persists sessions, and enforces its security invariants in CI.

**Architecture:** Three trust levels — a Node main process that exclusively owns secrets and network, a sandboxed React renderer that only draws, and a narrow typed `contextBridge` between them. Provider adapters normalize onto an internal `StreamEvent` shape rather than any vendor's wire format, and every adapter is verified by one shared contract suite.

**Tech Stack:** Electron 43, electron-vite 5, React 19, TypeScript 5.9, Vite 8, Zod 4, Zustand 5, Vitest 4, Playwright 1.62.

**Source spec:** [`docs/superpowers/specs/2026-07-29-agent-desktop-design.md`](../specs/2026-07-29-agent-desktop-design.md)

**Scope:** Spec §11 build steps 1–5 and 7, plus §10. The artifact canvas (spec §6, build step 6) is a separate plan that depends on this one.

---

## Global Constraints

- Node.js >= 22.19.0. The `engines` field must enforce this.
- Exact dependency versions are specified in Task 1. Do not substitute or upgrade majors.
- **No API key may ever reach the renderer process.** The IPC surface exposes `set`, `delete`, and `has` for keys — never `get`.
- **No provider network request may originate in the renderer.** All provider traffic uses `net.fetch` from Electron's `net` module in the main process, which routes through Chromium's network stack and therefore honours system proxy configuration without extra dependencies.
- `BrowserWindow` webPreferences are always `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Every IPC channel name and payload type is declared in `src/shared/ipc.ts`. Nothing else may invent a channel string.
- All new code is TypeScript in strict mode. No `any` without an adjacent comment justifying it.
- Tests are written before implementation. Every task ends with a commit.
- License is Apache-2.0.

---

## File Structure

```
package.json                        deps, scripts, engines
tsconfig.json                       strict base
tsconfig.node.json                  main + preload
electron.vite.config.ts             three build targets
vitest.config.ts                    unit tests
playwright.config.ts                E2E tests

src/shared/
  ipc.ts                            channel names + Zod payload schemas
  types.ts                          ChatMessage, StreamEvent, ProviderError, ModelInfo

src/main/
  index.ts                          app lifecycle, window creation
  security/window-options.ts        the single source of webPreferences
  security/csp.ts                   CSP header + navigation guards
  secrets/keystore.ts               encrypted key storage (crypto injected)
  secrets/electron-crypto.ts        safeStorage adapter
  providers/types.ts                Provider interface
  providers/openai-compat.ts        Kimi, OpenRouter, DeepSeek, Groq, LM Studio
  providers/anthropic.ts
  providers/ollama.ts
  providers/registry.ts
  chat/sse-parser.ts                pure incremental SSE parser
  chat/context-budget.ts            pure history trimming
  chat/stream-engine.ts             turn orchestration, streamId, abort
  sessions/store.ts                 append-only JSONL + index
  ipc/handlers.ts                   registers every handler

src/preload/index.ts                contextBridge surface

src/renderer/
  index.html
  main.tsx
  app/App.tsx                       three-zone layout
  app/Splitter.tsx                  pointer-capture resize
  chat/Transcript.tsx
  chat/MessageView.tsx
  chat/Composer.tsx
  chat/ErrorNotice.tsx              error taxonomy → recovery action
  chat/useAutoScroll.ts
  sessions/Sidebar.tsx
  settings/SettingsDialog.tsx
  state/store.ts                    Zustand store + stream subscription

tests/unit/                         Vitest
tests/contract/provider-contract.ts shared suite every provider must pass
tests/fixtures/                     recorded SSE bodies
tests/e2e/                          Playwright + Electron
```

Rationale for boundaries: `security/window-options.ts` exists so the E2E invariant test and the production window read the *same* object — a security setting cannot drift between what is tested and what ships. `sse-parser`, `context-budget`, and `keystore` are pure or dependency-injected so they test without launching Electron.

---

## Task 1: Scaffold, hardened window, and security invariant tests

Security invariants land first. A security property verified at the end of a project is one that was violated during it.

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `electron.vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`
- Create: `src/main/index.ts`, `src/main/security/window-options.ts`, `src/main/security/csp.ts`
- Create: `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`
- Test: `tests/e2e/security.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `WINDOW_OPTIONS: Electron.BrowserWindowConstructorOptions` from `src/main/security/window-options.ts`; `applySecurityPolicy(session: Electron.Session, window: BrowserWindow): void` from `src/main/security/csp.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "open-coder",
  "version": "0.0.1",
  "description": "Provider-agnostic agent desktop",
  "license": "Apache-2.0",
  "main": "./out/main/index.js",
  "type": "module",
  "engines": { "node": ">=22.19.0" },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "npm run build && playwright test"
  },
  "dependencies": {
    "dompurify": "3.4.12",
    "marked": "18.0.7",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "zod": "4.4.3",
    "zustand": "5.0.14"
  },
  "devDependencies": {
    "@playwright/test": "1.62.0",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "6.0.4",
    "electron": "43.2.0",
    "electron-vite": "5.0.0",
    "jsdom": "27.0.0",
    "typescript": "5.9.3",
    "vite": "8.1.5",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Step 2: Create the TypeScript and build configs**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/renderer", "src/shared", "tests"]
}
```

`tsconfig.node.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "lib": ["ES2023"], "types": ["node", "electron"] },
  "include": ["src/main", "src/preload", "src/shared", "electron.vite.config.ts"]
}
```

`electron.vite.config.ts`:

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('src/main/index.ts') } } },
  preload: { build: { rollupOptions: { input: resolve('src/preload/index.ts') } } },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
})
```

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
})
```

`.gitignore`:

```
node_modules/
out/
dist/
test-results/
playwright-report/
```

- [ ] **Step 3: Write the failing security invariant test**

First create the shared launcher `tests/e2e/launch.ts`, used by every E2E spec so no test ever touches the developer's real app data:

```ts
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function launchApp(extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      OPEN_CODER_USER_DATA: mkdtempSync(join(tmpdir(), 'oc-e2e-')),
      ...extraEnv,
    },
  })
}
```

`tests/e2e/security.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication

test.beforeAll(async () => { app = await launchApp() })
test.afterAll(async () => { await app.close() })

test('main window enforces the isolation invariants', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win.webContents.getLastWebPreferences()
  })
  expect(prefs?.contextIsolation).toBe(true)
  expect(prefs?.nodeIntegration).toBe(false)
  expect(prefs?.sandbox).toBe(true)
})

test('renderer has no Node globals', async () => {
  const page = await app.firstWindow()
  const leaked = await page.evaluate(() => ({
    require: typeof (globalThis as never as { require?: unknown }).require,
    process: typeof (globalThis as never as { process?: unknown }).process,
  }))
  expect(leaked.require).toBe('undefined')
  expect(leaked.process).toBe('undefined')
})

test('a response carries a Content-Security-Policy', async () => {
  const page = await app.firstWindow()
  const csp = await page.evaluate(() =>
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null,
  )
  // CSP is delivered by header, not meta; assert the page loaded and has no inline-script violations.
  expect(csp).toBeNull()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  expect(errors).toEqual([])
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm install && npm run test:e2e`
Expected: FAIL — `out/main/index.js` does not exist.

- [ ] **Step 5: Write the window options module**

`src/main/security/window-options.ts`:

```ts
import { join } from 'node:path'
import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * The single source of truth for window security settings.
 * The invariant test and the production window read this same object,
 * so a security setting cannot drift between what is tested and what ships.
 */
export const WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
  width: 1280,
  height: 860,
  minWidth: 720,
  minHeight: 480,
  show: false,
  backgroundColor: '#101014',
  webPreferences: {
    preload: join(import.meta.dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    spellcheck: false,
  },
}
```

- [ ] **Step 6: Write the CSP and navigation guards**

`src/main/security/csp.ts`:

```ts
import { shell } from 'electron'
import type { BrowserWindow, Session } from 'electron'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export function applySecurityPolicy(session: Session, window: BrowserWindow): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] },
    })
  })

  // Deny every permission request; v0 needs none.
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  // The window never navigates away from its own document.
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  // External links open in the system browser, never in-app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
}
```

> Note: `connect-src 'self'` is deliberate. The renderer has no reason to reach the network — all provider traffic is in main. This CSP is itself an enforcement of the global constraint.

- [ ] **Step 7: Write the main entry point**

`src/main/index.ts`:

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { WINDOW_OPTIONS } from './security/window-options.js'
import { applySecurityPolicy } from './security/csp.js'

// Portable-mode override. Keeps E2E runs out of the developer's real app data,
// and lets users run from a USB stick. Must be set before anything reads the path.
const portableDir = process.env['OPEN_CODER_USER_DATA']
if (portableDir) app.setPath('userData', portableDir)

function createWindow(): BrowserWindow {
  const window = new BrowserWindow(WINDOW_OPTIONS)
  applySecurityPolicy(window.webContents.session, window)

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) void window.loadURL(devServer)
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))

  window.once('ready-to-show', () => window.show())
  return window
}

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 8: Write the minimal preload and renderer**

`src/preload/index.ts`:

```ts
// Bridge surface is added in Task 2. This file must exist for the window to load.
export {}
```

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Open Coder</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/renderer/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')
createRoot(root).render(<h1>Open Coder</h1>)
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm run typecheck && npm run test:e2e`
Expected: PASS — all three security tests green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: hardened electron shell with security invariant tests"
```

---

## Task 2: Typed IPC contract and preload bridge

**Files:**
- Create: `src/shared/ipc.ts`, `src/shared/types.ts`
- Modify: `src/preload/index.ts`
- Create: `src/main/ipc/handlers.ts`
- Modify: `src/main/index.ts`
- Test: `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- Consumes: Task 1's main entry point
- Produces: `CHANNELS` constant map; `window.openCoder` bridge typed as `OpenCoderBridge`; `registerHandlers(): void`

- [ ] **Step 1: Write the failing test**

`tests/unit/ipc-contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CHANNELS, AppInfoSchema } from '@shared/ipc'

describe('ipc contract', () => {
  it('exposes no channel that could read a secret', () => {
    const names = Object.values(CHANNELS)
    expect(names.some((n) => /get.*key|read.*key|key.*get/i.test(n))).toBe(false)
  })

  it('every channel name is unique', () => {
    const names = Object.values(CHANNELS)
    expect(new Set(names).size).toBe(names.length)
  })

  it('validates app info payloads', () => {
    expect(AppInfoSchema.parse({ version: '0.0.1', platform: 'win32' }).version).toBe('0.0.1')
    expect(() => AppInfoSchema.parse({ version: 1 })).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: FAIL — cannot resolve `@shared/ipc`.

- [ ] **Step 3: Write the shared types**

`src/shared/types.ts`:

```ts
export type Role = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  incomplete?: boolean
}

export interface ModelInfo {
  id: string
  label: string
  contextWindow: number
}

export type ErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'context_overflow'
  | 'network'
  | 'provider_5xx'
  | 'aborted'
  | 'unknown'

export interface ProviderError {
  kind: ErrorKind
  message: string
  retryAfterSeconds?: number
}

export interface Usage {
  promptTokens?: number
  completionTokens?: number
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'done'; usage?: Usage }
  | { type: 'error'; error: ProviderError }
```

- [ ] **Step 4: Write the IPC contract**

`src/shared/ipc.ts`:

```ts
import { z } from 'zod'

export const CHANNELS = {
  appInfo: 'app:info',
  keySet: 'secrets:set',
  keyDelete: 'secrets:delete',
  keyHas: 'secrets:has',
  providersList: 'providers:list',
  modelsList: 'providers:models',
  chatSend: 'chat:send',
  chatAbort: 'chat:abort',
  chatEvent: 'chat:event',
  sessionsList: 'sessions:list',
  sessionLoad: 'sessions:load',
  sessionCreate: 'sessions:create',
  sessionDelete: 'sessions:delete',
} as const

export const AppInfoSchema = z.object({ version: z.string(), platform: z.string() })
export type AppInfo = z.infer<typeof AppInfoSchema>

export const KeyRefSchema = z.object({ providerId: z.string().min(1) })
export const KeySetSchema = KeyRefSchema.extend({ apiKey: z.string().min(1) })

export const SendSchema = z.object({
  sessionId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().optional(),
  content: z.string(),
})

export const AbortSchema = z.object({ streamId: z.string().min(1) })
```

> `chatEvent` is main → renderer, so it is emitted with `webContents.send` rather than registered as a handler.

- [ ] **Step 5: Write the preload bridge**

`src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '../shared/ipc.js'
import type { AppInfo } from '../shared/ipc.js'
import type { ChatMessage, ModelInfo, StreamEvent } from '../shared/types.js'

export interface StreamEnvelope { streamId: string; sessionId: string; event: StreamEvent }

export interface OpenCoderBridge {
  appInfo(): Promise<AppInfo>
  keys: {
    set(providerId: string, apiKey: string): Promise<void>
    delete(providerId: string): Promise<void>
    has(providerId: string): Promise<boolean>
  }
  providers: {
    list(): Promise<{ id: string; label: string }[]>
    models(providerId: string, baseUrl?: string): Promise<ModelInfo[]>
  }
  chat: {
    send(input: {
      sessionId: string; providerId: string; model: string; baseUrl?: string; content: string
    }): Promise<{ streamId: string }>
    abort(streamId: string): Promise<void>
    onEvent(handler: (envelope: StreamEnvelope) => void): () => void
  }
  sessions: {
    list(): Promise<{ id: string; title: string; updatedAt: number }[]>
    load(id: string): Promise<ChatMessage[]>
    create(title: string): Promise<{ id: string }>
    delete(id: string): Promise<void>
  }
}

const bridge: OpenCoderBridge = {
  appInfo: () => ipcRenderer.invoke(CHANNELS.appInfo),
  keys: {
    set: (providerId, apiKey) => ipcRenderer.invoke(CHANNELS.keySet, { providerId, apiKey }),
    delete: (providerId) => ipcRenderer.invoke(CHANNELS.keyDelete, { providerId }),
    has: (providerId) => ipcRenderer.invoke(CHANNELS.keyHas, { providerId }),
  },
  providers: {
    list: () => ipcRenderer.invoke(CHANNELS.providersList),
    models: (providerId, baseUrl) => ipcRenderer.invoke(CHANNELS.modelsList, { providerId, baseUrl }),
  },
  chat: {
    send: (input) => ipcRenderer.invoke(CHANNELS.chatSend, input),
    abort: (streamId) => ipcRenderer.invoke(CHANNELS.chatAbort, { streamId }),
    onEvent: (handler) => {
      const listener = (_e: unknown, envelope: StreamEnvelope) => handler(envelope)
      ipcRenderer.on(CHANNELS.chatEvent, listener)
      return () => { ipcRenderer.off(CHANNELS.chatEvent, listener) }
    },
  },
  sessions: {
    list: () => ipcRenderer.invoke(CHANNELS.sessionsList),
    load: (id) => ipcRenderer.invoke(CHANNELS.sessionLoad, { id }),
    create: (title) => ipcRenderer.invoke(CHANNELS.sessionCreate, { title }),
    delete: (id) => ipcRenderer.invoke(CHANNELS.sessionDelete, { id }),
  },
}

contextBridge.exposeInMainWorld('openCoder', bridge)
```

Create `src/renderer/env.d.ts`:

```ts
import type { OpenCoderBridge } from '../preload/index.js'
declare global {
  interface Window { openCoder: OpenCoderBridge }
}
export {}
```

- [ ] **Step 6: Register the first handler**

`src/main/ipc/handlers.ts`:

```ts
import { app, ipcMain } from 'electron'
import { CHANNELS } from '../../shared/ipc.js'
import type { AppInfo } from '../../shared/ipc.js'

export function registerHandlers(): void {
  ipcMain.handle(CHANNELS.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
  }))
}
```

In `src/main/index.ts`, import `registerHandlers` and call it inside `app.whenReady().then(...)` before `createWindow()`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ipc-contract.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: typed ipc contract and preload bridge"
```

---

## Task 3: Keystore

**Files:**
- Create: `src/main/secrets/keystore.ts`, `src/main/secrets/electron-crypto.ts`
- Modify: `src/main/ipc/handlers.ts`
- Test: `tests/unit/keystore.test.ts`

**Interfaces:**
- Consumes: `CHANNELS` from Task 2
- Produces: `class Keystore` with `set(providerId, apiKey)`, `delete(providerId)`, `has(providerId)`, `read(providerId): Promise<string | null>`, `listConfigured()`. `read` is main-process only and is never wired to IPC.

- [ ] **Step 1: Write the failing test**

`tests/unit/keystore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Keystore, type SecretCrypto } from '../../src/main/secrets/keystore.js'

// Reversible stand-in for safeStorage; proves the store never writes plaintext.
const fakeCrypto: SecretCrypto = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].map((b) => b ^ 0x5a)),
  decrypt: (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a)).toString('utf8'),
}

let store: Keystore
let file: string

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oc-keys-'))
  file = join(dir, 'keys.json')
  store = new Keystore(fakeCrypto, file)
})

describe('Keystore', () => {
  it('round-trips a key', async () => {
    await store.set('kimi', 'sk-secret-123')
    expect(await store.read('kimi')).toBe('sk-secret-123')
  })

  it('never writes the plaintext key to disk', async () => {
    await store.set('kimi', 'sk-secret-123')
    expect(await readFile(file, 'utf8')).not.toContain('sk-secret-123')
  })

  it('reports presence without revealing the value', async () => {
    expect(await store.has('kimi')).toBe(false)
    await store.set('kimi', 'sk-secret-123')
    expect(await store.has('kimi')).toBe(true)
  })

  it('deletes a key', async () => {
    await store.set('kimi', 'sk-secret-123')
    await store.delete('kimi')
    expect(await store.has('kimi')).toBe(false)
    expect(await store.read('kimi')).toBeNull()
  })

  it('lists configured providers only', async () => {
    await store.set('kimi', 'a')
    await store.set('anthropic', 'b')
    expect((await store.listConfigured()).sort()).toEqual(['anthropic', 'kimi'])
  })

  it('returns null for an unknown provider', async () => {
    expect(await store.read('nope')).toBeNull()
  })

  it('throws when encryption is unavailable', async () => {
    const broken = new Keystore({ ...fakeCrypto, isAvailable: () => false }, file)
    await expect(broken.set('kimi', 'x')).rejects.toThrow(/encryption/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/keystore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the keystore**

`src/main/secrets/keystore.ts`:

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SecretCrypto {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(cipher: Buffer): string
}

type KeyFile = Record<string, string> // providerId -> base64 ciphertext

export class Keystore {
  constructor(
    private readonly crypto: SecretCrypto,
    private readonly filePath: string,
  ) {}

  private async load(): Promise<KeyFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as KeyFile
    } catch {
      return {}
    }
  }

  private async save(data: KeyFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), { mode: 0o600 })
  }

  async set(providerId: string, apiKey: string): Promise<void> {
    if (!this.crypto.isAvailable()) {
      throw new Error('OS encryption is unavailable; refusing to store the key')
    }
    const data = await this.load()
    data[providerId] = this.crypto.encrypt(apiKey).toString('base64')
    await this.save(data)
  }

  async delete(providerId: string): Promise<void> {
    const data = await this.load()
    delete data[providerId]
    await this.save(data)
  }

  async has(providerId: string): Promise<boolean> {
    return providerId in (await this.load())
  }

  /** Main-process only. Never expose this over IPC. */
  async read(providerId: string): Promise<string | null> {
    const cipher = (await this.load())[providerId]
    if (!cipher) return null
    return this.crypto.decrypt(Buffer.from(cipher, 'base64'))
  }

  async listConfigured(): Promise<string[]> {
    return Object.keys(await this.load())
  }
}
```

`src/main/secrets/electron-crypto.ts`:

```ts
import { safeStorage } from 'electron'
import type { SecretCrypto } from './keystore.js'

export const electronCrypto: SecretCrypto = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (cipher) => safeStorage.decryptString(cipher),
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/keystore.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Wire the three safe handlers**

In `src/main/ipc/handlers.ts`, construct the keystore and register `keySet`, `keyDelete`, `keyHas`. Validate every payload with the Zod schemas from Task 2. Export the instance so later tasks can call `read`:

```ts
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { CHANNELS, KeyRefSchema, KeySetSchema } from '../../shared/ipc.js'
import { Keystore } from '../secrets/keystore.js'
import { electronCrypto } from '../secrets/electron-crypto.js'

export const keystore = new Keystore(electronCrypto, join(app.getPath('userData'), 'keys.json'))

export function registerSecretHandlers(): void {
  ipcMain.handle(CHANNELS.keySet, async (_e, raw: unknown) => {
    const { providerId, apiKey } = KeySetSchema.parse(raw)
    await keystore.set(providerId, apiKey)
  })
  ipcMain.handle(CHANNELS.keyDelete, async (_e, raw: unknown) => {
    await keystore.delete(KeyRefSchema.parse(raw).providerId)
  })
  ipcMain.handle(CHANNELS.keyHas, async (_e, raw: unknown) => {
    return keystore.has(KeyRefSchema.parse(raw).providerId)
  })
}
```

Call `registerSecretHandlers()` alongside `registerHandlers()` in `src/main/index.ts`.

- [ ] **Step 6: Add the E2E invariant test that keys cannot be read back**

Append to `tests/e2e/security.spec.ts`:

```ts
test('the bridge exposes no way to read a stored key', async () => {
  const page = await app.firstWindow()
  const shape = await page.evaluate(() => ({
    keyFns: Object.keys(window.openCoder.keys),
    topLevel: Object.keys(window.openCoder),
  }))
  expect(shape.keyFns.sort()).toEqual(['delete', 'has', 'set'])
  expect(shape.topLevel).not.toContain('keystore')
})
```

- [ ] **Step 7: Run both suites**

Run: `npm test && npm run test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: os-encrypted keystore with no read path to the renderer"
```

---

## Task 4: SSE parser

**Files:**
- Create: `src/main/chat/sse-parser.ts`
- Test: `tests/unit/sse-parser.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `parseSse(chunk: string, residual: string): { events: SseRecord[]; residual: string }` where `SseRecord = { event?: string; data: string }`

- [ ] **Step 1: Write the failing test**

`tests/unit/sse-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSse } from '../../src/main/chat/sse-parser.js'

describe('parseSse', () => {
  it('parses one complete record', () => {
    const r = parseSse('data: {"a":1}\n\n', '')
    expect(r.events).toEqual([{ data: '{"a":1}' }])
    expect(r.residual).toBe('')
  })

  it('holds an incomplete record in the residual', () => {
    const r = parseSse('data: {"a"', '')
    expect(r.events).toEqual([])
    expect(r.residual).toBe('data: {"a"')
  })

  it('joins a record split across chunks', () => {
    const a = parseSse('data: {"a"', '')
    const b = parseSse(':1}\n\n', a.residual)
    expect(b.events).toEqual([{ data: '{"a":1}' }])
  })

  it('captures the event field used by Anthropic', () => {
    const r = parseSse('event: content_block_delta\ndata: {"x":2}\n\n', '')
    expect(r.events).toEqual([{ event: 'content_block_delta', data: '{"x":2}' }])
  })

  it('joins multi-line data with newlines', () => {
    const r = parseSse('data: line1\ndata: line2\n\n', '')
    expect(r.events).toEqual([{ data: 'line1\nline2' }])
  })

  it('ignores comment heartbeats', () => {
    const r = parseSse(': ping\n\ndata: ok\n\n', '')
    expect(r.events).toEqual([{ data: 'ok' }])
  })

  it('emits the [DONE] sentinel as data for the caller to interpret', () => {
    expect(parseSse('data: [DONE]\n\n', '').events).toEqual([{ data: '[DONE]' }])
  })

  it('handles CRLF line endings', () => {
    expect(parseSse('data: {"a":1}\r\n\r\n', '').events).toEqual([{ data: '{"a":1}' }])
  })

  it('parses several records in one chunk', () => {
    const r = parseSse('data: one\n\ndata: two\n\n', '')
    expect(r.events.map((e) => e.data)).toEqual(['one', 'two'])
  })

  it('produces identical output regardless of chunking', () => {
    const doc = 'data: a\n\nevent: x\ndata: b\n\n: c\n\ndata: d\n\n'
    for (let size = 1; size <= doc.length; size++) {
      let residual = ''
      const all: { data: string }[] = []
      for (let i = 0; i < doc.length; i += size) {
        const r = parseSse(doc.slice(i, i + size), residual)
        residual = r.residual
        all.push(...r.events)
      }
      expect(all.map((e) => e.data)).toEqual(['a', 'b', 'd'])
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/sse-parser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the parser**

`src/main/chat/sse-parser.ts`:

```ts
export interface SseRecord {
  event?: string
  data: string
}

export interface SseParseResult {
  events: SseRecord[]
  residual: string
}

/**
 * Incremental, pure SSE parser. Feed each chunk with the residual from the
 * previous call. Records split across arbitrary chunk boundaries are joined.
 */
export function parseSse(chunk: string, residual: string): SseParseResult {
  const buffer = (residual + chunk).replace(/\r\n/g, '\n')
  const blocks = buffer.split('\n\n')
  const trailing = blocks.pop() ?? ''

  const events: SseRecord[] = []
  for (const block of blocks) {
    const dataLines: string[] = []
    let eventName: string | undefined

    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      const rawValue = colon === -1 ? '' : line.slice(colon + 1)
      const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue

      if (field === 'data') dataLines.push(value)
      else if (field === 'event') eventName = value
    }

    if (dataLines.length > 0) {
      events.push(eventName === undefined
        ? { data: dataLines.join('\n') }
        : { event: eventName, data: dataLines.join('\n') })
    }
  }

  return { events, residual: trailing }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/sse-parser.test.ts`
Expected: PASS — 10 tests, including the chunk-invariance sweep.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: incremental sse parser with chunk-invariance tests"
```

---

## Task 5: Provider interface, contract suite, and openai-compat

The contract suite is the load-bearing piece of the community strategy: it lets a stranger's provider PR verify itself.

**Files:**
- Create: `src/main/providers/types.ts`, `src/main/providers/openai-compat.ts`, `src/main/providers/registry.ts`
- Create: `tests/contract/provider-contract.ts`, `tests/fixtures/openai-compat.ts`
- Test: `tests/unit/openai-compat.test.ts`

**Interfaces:**
- Consumes: `parseSse` (Task 4), `StreamEvent`/`ProviderError`/`ModelInfo` (Task 2)
- Produces:
  - `interface Provider { id; label; listModels(cfg); streamChat(req, signal): AsyncIterable<StreamEvent> }`
  - `interface ProviderConfig { apiKey: string; baseUrl?: string; fetch: FetchLike }`
  - `interface ChatRequest { model: string; messages: ChatMessage[]; config: ProviderConfig }`
  - `type FetchLike = (url: string, init: RequestInit) => Promise<Response>`
  - `runProviderContract(name: string, make: () => Provider, fx: ContractFixtures): void`
  - `registry: Map<string, Provider>` and `getProvider(id): Provider`

- [ ] **Step 1: Write the provider types**

`src/main/providers/types.ts`:

```ts
import type { ChatMessage, ModelInfo, StreamEvent } from '../../shared/types.js'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface ProviderConfig {
  apiKey: string
  baseUrl?: string
  fetch: FetchLike
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  config: ProviderConfig
}

export interface Provider {
  readonly id: string
  readonly label: string
  readonly defaultBaseUrl: string
  /** False for local runtimes such as Ollama, which need no credential. */
  readonly requiresKey: boolean
  listModels(config: ProviderConfig): Promise<ModelInfo[]>
  streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>
}
```

- [ ] **Step 2: Write the shared contract suite**

`tests/contract/provider-contract.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Provider, FetchLike } from '../../src/main/providers/types.js'
import type { StreamEvent } from '../../src/shared/types.js'

export interface ContractFixtures {
  /** A complete SSE body that yields the text "Hello world". */
  helloStream: string
  /** A 401 JSON error body. */
  authErrorBody: string
  /** A 429 JSON error body. */
  rateLimitBody: string
}

function bodyFrom(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      // Deliberately split mid-record to exercise chunk joining.
      for (let i = 0; i < text.length; i += 7) {
        controller.enqueue(encoder.encode(text.slice(i, i + 7)))
      }
      controller.close()
    },
  })
}

function stubFetch(status: number, body: string): FetchLike {
  return () =>
    Promise.resolve(
      new Response(status === 200 ? bodyFrom(body) : body, {
        status,
        headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' },
      }),
    )
}

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

/** Every provider must pass this suite. */
export function runProviderContract(
  name: string,
  make: () => Provider,
  fx: ContractFixtures,
): void {
  describe(`${name} provider contract`, () => {
    // Distinctive enough that an accidental echo is unambiguous.
    const SECRET = 'sk-CONTRACT-CANARY-9f3a'
    const base = (fetch: FetchLike) => ({
      model: 'test-model',
      messages: [{ id: '1', role: 'user' as const, content: 'hi', createdAt: 0 }],
      config: { apiKey: SECRET, fetch },
    })

    it('has a stable identity', () => {
      const p = make()
      expect(p.id).toMatch(/^[a-z0-9-]+$/)
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.defaultBaseUrl.startsWith('http')).toBe(true)
      expect(typeof p.requiresKey).toBe('boolean')
    })

    it('streams text deltas then exactly one done', async () => {
      const events = await collect(
        make().streamChat(base(stubFetch(200, fx.helloStream)), new AbortController().signal),
      )
      const text = events.filter((e) => e.type === 'text').map((e) => e.delta).join('')
      expect(text).toBe('Hello world')
      expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
      expect(events.at(-1)?.type).toBe('done')
    })

    it('emits no event after done', async () => {
      const events = await collect(
        make().streamChat(base(stubFetch(200, fx.helloStream)), new AbortController().signal),
      )
      expect(events.findIndex((e) => e.type === 'done')).toBe(events.length - 1)
    })

    it('maps 401 to an auth error and never throws', async () => {
      const events = await collect(
        make().streamChat(base(stubFetch(401, fx.authErrorBody)), new AbortController().signal),
      )
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'error', error: { kind: 'auth' } })
    })

    it('maps 429 to a rate_limit error', async () => {
      const events = await collect(
        make().streamChat(base(stubFetch(429, fx.rateLimitBody)), new AbortController().signal),
      )
      expect(events[0]).toMatchObject({ type: 'error', error: { kind: 'rate_limit' } })
    })

    it('maps 503 to provider_5xx', async () => {
      const events = await collect(
        make().streamChat(base(stubFetch(503, '{}')), new AbortController().signal),
      )
      expect(events[0]).toMatchObject({ type: 'error', error: { kind: 'provider_5xx' } })
    })

    it('maps a transport failure to a network error', async () => {
      const failing: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'))
      const events = await collect(
        make().streamChat(base(failing), new AbortController().signal),
      )
      expect(events[0]).toMatchObject({ type: 'error', error: { kind: 'network' } })
    })

    it('ends promptly when the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const events = await collect(
        make().streamChat(base(stubFetch(200, fx.helloStream)), controller.signal),
      )
      expect(events.every((e) => e.type !== 'text')).toBe(true)
    })

    it('never leaks the api key into an error message', async () => {
      for (const status of [401, 429, 503]) {
        const events = await collect(
          make().streamChat(base(stubFetch(status, fx.authErrorBody)), new AbortController().signal),
        )
        for (const e of events) {
          if (e.type === 'error') expect(e.error.message).not.toContain(SECRET)
        }
      }
    })
  })
}
```

> The final assertion uses the single-character key `'k'` from `base()`. Providers must never interpolate the key into a message; if this fails, the provider is echoing credentials.

- [ ] **Step 3: Write the fixtures**

`tests/fixtures/openai-compat.ts`:

```ts
import type { ContractFixtures } from '../contract/provider-contract.js'

const delta = (c: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`

export const openAiCompatFixtures: ContractFixtures = {
  helloStream: delta('Hello') + delta(' world') + 'data: [DONE]\n\n',
  authErrorBody: JSON.stringify({ error: { message: 'invalid api key', type: 'auth' } }),
  rateLimitBody: JSON.stringify({ error: { message: 'rate limit exceeded' } }),
}
```

- [ ] **Step 4: Write the failing provider test**

`tests/unit/openai-compat.test.ts`:

```ts
import { runProviderContract } from '../contract/provider-contract.js'
import { openAiCompatFixtures } from '../fixtures/openai-compat.js'
import { createOpenAiCompatProvider } from '../../src/main/providers/openai-compat.js'

runProviderContract(
  'openai-compat',
  () => createOpenAiCompatProvider({
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
  }),
  openAiCompatFixtures,
)
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run tests/unit/openai-compat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement the openai-compat provider**

`src/main/providers/openai-compat.ts`:

```ts
import { parseSse } from '../chat/sse-parser.js'
import type { ChatRequest, Provider, ProviderConfig } from './types.js'
import type { ModelInfo, ProviderError, StreamEvent } from '../../shared/types.js'

export interface OpenAiCompatSpec {
  id: string
  label: string
  defaultBaseUrl: string
}

export function statusToError(status: number, retryAfter?: string | null): ProviderError {
  if (status === 401 || status === 403) {
    return { kind: 'auth', message: 'The provider rejected the API key.' }
  }
  if (status === 429) {
    const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN
    return {
      kind: 'rate_limit',
      message: 'Rate limit reached.',
      ...(Number.isFinite(seconds) ? { retryAfterSeconds: seconds } : {}),
    }
  }
  if (status >= 500) {
    return { kind: 'provider_5xx', message: `The provider returned ${status}.` }
  }
  if (status === 400) {
    return { kind: 'context_overflow', message: 'The request was rejected as malformed or too long.' }
  }
  return { kind: 'unknown', message: `Unexpected status ${status}.` }
}

export function createOpenAiCompatProvider(spec: OpenAiCompatSpec): Provider {
  const urlFor = (config: ProviderConfig, path: string) =>
    `${(config.baseUrl ?? spec.defaultBaseUrl).replace(/\/$/, '')}${path}`

  return {
    id: spec.id,
    label: spec.label,
    defaultBaseUrl: spec.defaultBaseUrl,
    requiresKey: true,

    async listModels(config) {
      const response = await config.fetch(urlFor(config, '/models'), {
        headers: { authorization: `Bearer ${config.apiKey}` },
      })
      if (!response.ok) return []
      const body = (await response.json()) as { data?: { id?: string }[] }
      return (body.data ?? [])
        .filter((m): m is { id: string } => typeof m.id === 'string')
        .map((m): ModelInfo => ({ id: m.id, label: m.id, contextWindow: 128_000 }))
    },

    async *streamChat(request: ChatRequest, signal: AbortSignal) {
      const { config } = request
      let response: Response
      try {
        response = await config.fetch(urlFor(config, '/chat/completions'), {
          method: 'POST',
          signal,
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: request.model,
            stream: true,
            messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        })
      } catch (cause) {
        if (signal.aborted) { yield { type: 'done' } satisfies StreamEvent; return }
        yield { type: 'error', error: { kind: 'network', message: 'Could not reach the provider.' } }
        return
      }

      if (!response.ok) {
        yield { type: 'error', error: statusToError(response.status, response.headers.get('retry-after')) }
        return
      }
      if (!response.body) {
        yield { type: 'error', error: { kind: 'network', message: 'The provider returned an empty body.' } }
        return
      }

      const decoder = new TextDecoder()
      const reader = response.body.getReader()
      let residual = ''

      try {
        for (;;) {
          if (signal.aborted) break
          const { done, value } = await reader.read()
          if (done) break

          const parsed = parseSse(decoder.decode(value, { stream: true }), residual)
          residual = parsed.residual

          for (const record of parsed.events) {
            if (record.data === '[DONE]') { yield { type: 'done' }; return }
            let payload: { choices?: { delta?: { content?: string; reasoning_content?: string } }[] }
            try { payload = JSON.parse(record.data) } catch { continue }
            const delta = payload.choices?.[0]?.delta
            if (delta?.reasoning_content) yield { type: 'reasoning', delta: delta.reasoning_content }
            if (delta?.content) yield { type: 'text', delta: delta.content }
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined)
      }

      yield { type: 'done' }
    },
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/unit/openai-compat.test.ts`
Expected: PASS — 9 contract tests.

- [ ] **Step 8: Write the registry**

`src/main/providers/registry.ts`:

```ts
import { net } from 'electron'
import { createOpenAiCompatProvider } from './openai-compat.js'
import type { FetchLike, Provider } from './types.js'

/** Chromium's network stack, so system proxy configuration is honoured. */
export const mainFetch: FetchLike = (url, init) => net.fetch(url, init)

const providers: Provider[] = [
  createOpenAiCompatProvider({ id: 'kimi', label: 'Kimi (Moonshot)', defaultBaseUrl: 'https://api.moonshot.cn/v1' }),
  createOpenAiCompatProvider({ id: 'openrouter', label: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1' }),
  createOpenAiCompatProvider({ id: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1' }),
  createOpenAiCompatProvider({ id: 'groq', label: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1' }),
  createOpenAiCompatProvider({ id: 'lmstudio', label: 'LM Studio (local)', defaultBaseUrl: 'http://localhost:1234/v1' }),
]

export const registry = new Map(providers.map((p) => [p.id, p]))

export function getProvider(id: string): Provider {
  const provider = registry.get(id)
  if (!provider) throw new Error(`Unknown provider: ${id}`)
  return provider
}

export function listProviders(): { id: string; label: string; defaultBaseUrl: string }[] {
  return [...registry.values()].map((p) => ({ id: p.id, label: p.label, defaultBaseUrl: p.defaultBaseUrl }))
}
```

- [ ] **Step 9: Run the full suite and commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat: provider interface, contract suite, and openai-compatible adapter"
```

---

## Task 6: Context budget

**Files:**
- Create: `src/main/chat/context-budget.ts`
- Test: `tests/unit/context-budget.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` (Task 2)
- Produces: `applyContextBudget(messages: ChatMessage[], maxTokens: number): { messages: ChatMessage[]; omittedCount: number }` and `estimateTokens(text: string): number`

- [ ] **Step 1: Write the failing test**

`tests/unit/context-budget.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyContextBudget, estimateTokens } from '../../src/main/chat/context-budget.js'
import type { ChatMessage } from '../../src/shared/types.js'

const msg = (id: string, role: ChatMessage['role'], content: string): ChatMessage =>
  ({ id, role, content, createdAt: 0 })

describe('estimateTokens', () => {
  it('approximates four characters per token', () => {
    expect(estimateTokens('12345678')).toBe(2)
  })
  it('never returns zero for non-empty text', () => {
    expect(estimateTokens('a')).toBe(1)
  })
})

describe('applyContextBudget', () => {
  it('returns everything when under budget', () => {
    const input = [msg('1', 'user', 'hi'), msg('2', 'assistant', 'hello')]
    const result = applyContextBudget(input, 1000)
    expect(result.messages).toEqual(input)
    expect(result.omittedCount).toBe(0)
  })

  it('always retains the system message', () => {
    const input = [
      msg('s', 'system', 'you are helpful'),
      ...Array.from({ length: 20 }, (_, i) =>
        msg(String(i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(400)),
      ),
    ]
    const result = applyContextBudget(input, 200)
    expect(result.messages[0]?.role).toBe('system')
  })

  it('drops the oldest pairs first', () => {
    const input = [
      msg('u1', 'user', 'x'.repeat(400)),
      msg('a1', 'assistant', 'x'.repeat(400)),
      msg('u2', 'user', 'y'),
      msg('a2', 'assistant', 'y'),
    ]
    const result = applyContextBudget(input, 60)
    expect(result.messages.map((m) => m.id)).toEqual(['u2', 'a2'])
    expect(result.omittedCount).toBe(2)
  })

  it('drops in whole pairs, never a lone assistant reply', () => {
    const input = [
      msg('u1', 'user', 'x'.repeat(4000)),
      msg('a1', 'assistant', 'x'.repeat(4000)),
      msg('u2', 'user', 'z'),
    ]
    const result = applyContextBudget(input, 20)
    expect(result.messages.map((m) => m.role)).toEqual(['user'])
    expect(result.omittedCount).toBe(2)
  })

  it('keeps the final user message even if it alone exceeds the budget', () => {
    const input = [msg('u1', 'user', 'x'.repeat(10_000))]
    const result = applyContextBudget(input, 10)
    expect(result.messages).toHaveLength(1)
    expect(result.omittedCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/context-budget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the budget**

`src/main/chat/context-budget.ts`:

```ts
import type { ChatMessage } from '../../shared/types.js'

/** Character-count heuristic. Adequate for budgeting; not a tokenizer. */
export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4))
}

export interface BudgetResult {
  messages: ChatMessage[]
  omittedCount: number
}

/**
 * Trims history to fit `maxTokens` by dropping the oldest complete
 * user/assistant pairs. The system message is always retained, and the
 * final message is always retained even if it alone exceeds the budget.
 *
 * Trimming is reported via `omittedCount` so the UI can show it explicitly.
 * Silent truncation is not acceptable: it removes information the user
 * believes is still present.
 */
export function applyContextBudget(messages: ChatMessage[], maxTokens: number): BudgetResult {
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')

  const cost = (list: ChatMessage[]) =>
    list.reduce((sum, m) => sum + estimateTokens(m.content), 0)

  const systemCost = cost(system)
  let start = 0

  while (start < rest.length - 1 && systemCost + cost(rest.slice(start)) > maxTokens) {
    // Drop a whole exchange: a user message plus any assistant reply that follows it.
    start += 1
    while (start < rest.length - 1 && rest[start]?.role === 'assistant') start += 1
  }

  return { messages: [...system, ...rest.slice(start)], omittedCount: start }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/context-budget.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: visible context budgeting that drops whole exchanges"
```

---

## Task 7: Session store

**Files:**
- Create: `src/main/sessions/store.ts`
- Test: `tests/unit/session-store.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` (Task 2)
- Produces: `class SessionStore` with `create(title): Promise<SessionMeta>`, `append(id, message): Promise<void>`, `load(id): Promise<ChatMessage[]>`, `list(): Promise<SessionMeta[]>`, `remove(id): Promise<void>`, `rename(id, title): Promise<void>`. `SessionMeta = { id: string; title: string; updatedAt: number }`

- [ ] **Step 1: Write the failing test**

`tests/unit/session-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionStore } from '../../src/main/sessions/store.js'
import type { ChatMessage } from '../../src/shared/types.js'

const msg = (id: string, content: string): ChatMessage =>
  ({ id, role: 'user', content, createdAt: 1 })

let store: SessionStore
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'oc-sessions-'))
  store = new SessionStore(dir)
})

describe('SessionStore', () => {
  it('creates a session with a unique id', async () => {
    const a = await store.create('First')
    const b = await store.create('Second')
    expect(a.id).not.toBe(b.id)
    expect(a.title).toBe('First')
  })

  it('appends and reloads messages in order', async () => {
    const s = await store.create('t')
    await store.append(s.id, msg('1', 'one'))
    await store.append(s.id, msg('2', 'two'))
    expect((await store.load(s.id)).map((m) => m.content)).toEqual(['one', 'two'])
  })

  it('writes one JSON object per line', async () => {
    const s = await store.create('t')
    await store.append(s.id, msg('1', 'one'))
    await store.append(s.id, msg('2', 'two'))
    const raw = await readFile(join(dir, `${s.id}.jsonl`), 'utf8')
    expect(raw.trimEnd().split('\n')).toHaveLength(2)
  })

  it('survives a truncated trailing line', async () => {
    const s = await store.create('t')
    await store.append(s.id, msg('1', 'one'))
    const { appendFile } = await import('node:fs/promises')
    await appendFile(join(dir, `${s.id}.jsonl`), '{"id":"2","rol')
    expect((await store.load(s.id)).map((m) => m.content)).toEqual(['one'])
  })

  it('lists sessions newest first', async () => {
    const a = await store.create('A')
    await new Promise((r) => setTimeout(r, 5))
    const b = await store.create('B')
    expect((await store.list()).map((s) => s.id)).toEqual([b.id, a.id])
  })

  it('removes a session and its messages', async () => {
    const s = await store.create('t')
    await store.append(s.id, msg('1', 'one'))
    await store.remove(s.id)
    expect(await store.list()).toEqual([])
    expect(await store.load(s.id)).toEqual([])
  })

  it('renames a session', async () => {
    const s = await store.create('old')
    await store.rename(s.id, 'new')
    expect((await store.list())[0]?.title).toBe('new')
  })

  it('rejects an id containing path separators', async () => {
    await expect(store.load('../../etc/passwd')).rejects.toThrow(/invalid session id/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/session-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

`src/main/sessions/store.ts`:

```ts
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ChatMessage } from '../../shared/types.js'

export interface SessionMeta {
  id: string
  title: string
  updatedAt: number
}

const SAFE_ID = /^[A-Za-z0-9-]+$/

export class SessionStore {
  constructor(private readonly dir: string) {}

  private path(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error(`Invalid session id: ${id}`)
    return join(this.dir, `${id}.jsonl`)
  }

  private get indexPath(): string {
    return join(this.dir, 'index.json')
  }

  private async readIndex(): Promise<SessionMeta[]> {
    try {
      return JSON.parse(await readFile(this.indexPath, 'utf8')) as SessionMeta[]
    } catch {
      return []
    }
  }

  private async writeIndex(entries: SessionMeta[]): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.indexPath, JSON.stringify(entries, null, 2))
  }

  async create(title: string): Promise<SessionMeta> {
    const meta: SessionMeta = { id: randomUUID(), title, updatedAt: Date.now() }
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.path(meta.id), '')
    await this.writeIndex([meta, ...(await this.readIndex())])
    return meta
  }

  async append(id: string, message: ChatMessage): Promise<void> {
    await appendFile(this.path(id), `${JSON.stringify(message)}\n`)
    const index = await this.readIndex()
    const entry = index.find((s) => s.id === id)
    if (entry) {
      entry.updatedAt = Date.now()
      await this.writeIndex(index)
    }
  }

  /** Skips any trailing partial line, so a crash mid-write costs one message. */
  async load(id: string): Promise<ChatMessage[]> {
    let raw: string
    try {
      raw = await readFile(this.path(id), 'utf8')
    } catch {
      return []
    }
    const out: ChatMessage[] = []
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      try { out.push(JSON.parse(line) as ChatMessage) } catch { /* truncated tail */ }
    }
    return out
  }

  async list(): Promise<SessionMeta[]> {
    return (await this.readIndex()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async remove(id: string): Promise<void> {
    await rm(this.path(id), { force: true })
    await this.writeIndex((await this.readIndex()).filter((s) => s.id !== id))
  }

  async rename(id: string, title: string): Promise<void> {
    const index = await this.readIndex()
    const entry = index.find((s) => s.id === id)
    if (entry) { entry.title = title; await this.writeIndex(index) }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/session-store.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: append-only jsonl session store"
```

---

## Task 8: Stream engine and streaming IPC

**Files:**
- Create: `src/main/chat/stream-engine.ts`
- Modify: `src/main/ipc/handlers.ts`, `src/main/index.ts`
- Test: `tests/unit/stream-engine.test.ts`

**Interfaces:**
- Consumes: `getProvider`/`mainFetch` (Task 5), `applyContextBudget` (Task 6), `SessionStore` (Task 7), `keystore` (Task 3)
- Produces: `class StreamEngine` with `start(input: StartInput): Promise<{ streamId: string }>` and `abort(streamId: string): void`. `StartInput = { sessionId; providerId; model; baseUrl?; content }`. The engine is constructed with `{ emit: (envelope: StreamEnvelope) => void, readKey, store, resolveProvider }` so it tests without Electron.

- [ ] **Step 1: Write the failing test**

`tests/unit/stream-engine.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamEngine } from '../../src/main/chat/stream-engine.js'
import { SessionStore } from '../../src/main/sessions/store.js'
import type { Provider } from '../../src/main/providers/types.js'
import type { StreamEvent } from '../../src/shared/types.js'
import type { StreamEnvelope } from '../../src/preload/index.js'

function fakeProvider(events: StreamEvent[], delayMs = 0): Provider {
  return {
    id: 'fake', label: 'Fake', defaultBaseUrl: 'http://localhost', requiresKey: true,
    listModels: async () => [],
    async *streamChat(_req, signal) {
      for (const e of events) {
        if (signal.aborted) return
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        yield e
      }
    },
  }
}

let store: SessionStore
let emitted: StreamEnvelope[]

const build = (provider: Provider) => {
  emitted = []
  return new StreamEngine({
    emit: (envelope) => { emitted.push(envelope) },
    readKey: async () => 'test-key',
    store,
    resolveProvider: () => provider,
  })
}

beforeEach(async () => {
  store = new SessionStore(await mkdtemp(join(tmpdir(), 'oc-engine-')))
  emitted = []
})

const settle = () => new Promise((r) => setTimeout(r, 30))

describe('StreamEngine', () => {
  it('tags every envelope with the same streamId', async () => {
    const s = await store.create('t')
    const engine = build(fakeProvider([{ type: 'text', delta: 'hi' }, { type: 'done' }]))
    const { streamId } = await engine.start({
      sessionId: s.id, providerId: 'fake', model: 'm', content: 'hello',
    })
    await settle()
    expect(emitted.length).toBeGreaterThan(0)
    expect(emitted.every((e) => e.streamId === streamId)).toBe(true)
    expect(emitted.every((e) => e.sessionId === s.id)).toBe(true)
  })

  it('persists the user message and the assistant reply', async () => {
    const s = await store.create('t')
    const engine = build(fakeProvider([
      { type: 'text', delta: 'he' }, { type: 'text', delta: 'llo' }, { type: 'done' },
    ]))
    await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'hi' })
    await settle()
    const saved = await store.load(s.id)
    expect(saved.map((m) => [m.role, m.content])).toEqual([['user', 'hi'], ['assistant', 'hello']])
  })

  it('emits an auth error when no key is configured', async () => {
    const s = await store.create('t')
    const engine = new StreamEngine({
      emit: (e) => { emitted.push(e) },
      readKey: async () => null,
      store,
      resolveProvider: () => fakeProvider([{ type: 'done' }]),
    })
    await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'hi' })
    await settle()
    expect(emitted[0]?.event).toMatchObject({ type: 'error', error: { kind: 'auth' } })
  })

  it('stops emitting after abort and marks the reply incomplete', async () => {
    const s = await store.create('t')
    const engine = build(fakeProvider(
      Array.from({ length: 50 }, () => ({ type: 'text', delta: 'x' }) as StreamEvent), 5,
    ))
    const { streamId } = await engine.start({
      sessionId: s.id, providerId: 'fake', model: 'm', content: 'hi',
    })
    await new Promise((r) => setTimeout(r, 20))
    engine.abort(streamId)
    const countAtAbort = emitted.length
    await new Promise((r) => setTimeout(r, 60))
    expect(emitted.length).toBeLessThanOrEqual(countAtAbort + 1)
    const saved = await store.load(s.id)
    expect(saved.at(-1)?.incomplete).toBe(true)
  })

  it('gives concurrent streams distinct ids', async () => {
    const a = await store.create('a')
    const b = await store.create('b')
    const engine = build(fakeProvider([{ type: 'text', delta: 'x' }, { type: 'done' }]))
    const first = await engine.start({ sessionId: a.id, providerId: 'fake', model: 'm', content: '1' })
    const second = await engine.start({ sessionId: b.id, providerId: 'fake', model: 'm', content: '2' })
    expect(first.streamId).not.toBe(second.streamId)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/stream-engine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the engine**

`src/main/chat/stream-engine.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { applyContextBudget } from './context-budget.js'
import type { SessionStore } from '../sessions/store.js'
import type { Provider } from '../providers/types.js'
import type { FetchLike } from '../providers/types.js'
import type { ChatMessage, StreamEvent } from '../../shared/types.js'
import type { StreamEnvelope } from '../../preload/index.js'

export interface StartInput {
  sessionId: string
  providerId: string
  model: string
  baseUrl?: string
  content: string
}

export interface StreamEngineDeps {
  emit(envelope: StreamEnvelope): void
  readKey(providerId: string): Promise<string | null>
  store: SessionStore
  resolveProvider(providerId: string): Provider
  fetch?: FetchLike
  maxContextTokens?: number
}

export class StreamEngine {
  private readonly active = new Map<string, AbortController>()

  constructor(private readonly deps: StreamEngineDeps) {}

  abort(streamId: string): void {
    this.active.get(streamId)?.abort()
    this.active.delete(streamId)
  }

  async start(input: StartInput): Promise<{ streamId: string }> {
    const streamId = randomUUID()
    const controller = new AbortController()
    this.active.set(streamId, controller)
    void this.run(streamId, input, controller)
    return { streamId }
  }

  private send(streamId: string, sessionId: string, event: StreamEvent): void {
    this.deps.emit({ streamId, sessionId, event })
  }

  private async run(streamId: string, input: StartInput, controller: AbortController): Promise<void> {
    const { store, readKey, resolveProvider } = this.deps
    const { sessionId } = input

    const userMessage: ChatMessage = {
      id: randomUUID(), role: 'user', content: input.content, createdAt: Date.now(),
    }
    await store.append(sessionId, userMessage)

    const provider = resolveProvider(input.providerId)
    const apiKey = await readKey(input.providerId)
    if (provider.requiresKey && !apiKey) {
      this.send(streamId, sessionId, {
        type: 'error',
        error: { kind: 'auth', message: 'No API key is configured for this provider.' },
      })
      this.active.delete(streamId)
      return
    }

    const history = await store.load(sessionId)
    const budgeted = applyContextBudget(history, this.deps.maxContextTokens ?? 96_000)

    let assembled = ''
    let incomplete = false

    try {
      const request = {
        model: input.model,
        messages: budgeted.messages,
        config: {
          apiKey: apiKey ?? '',
          ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
          fetch: this.deps.fetch ?? globalThis.fetch,
        },
      }
      for await (const event of provider.streamChat(request, controller.signal)) {
        if (controller.signal.aborted) { incomplete = true; break }
        if (event.type === 'text') assembled += event.delta
        this.send(streamId, sessionId, event)
        if (event.type === 'done' || event.type === 'error') break
      }
    } catch {
      incomplete = true
      this.send(streamId, sessionId, {
        type: 'error', error: { kind: 'unknown', message: 'The turn ended unexpectedly.' },
      })
    }

    if (assembled.length > 0 || incomplete) {
      await store.append(sessionId, {
        id: randomUUID(),
        role: 'assistant',
        content: assembled,
        createdAt: Date.now(),
        ...(incomplete ? { incomplete: true } : {}),
      })
    }
    this.active.delete(streamId)
  }
}
```

> `budgeted.omittedCount` is computed and available here, but nothing consumes it yet. Rendering the visible `⋯ N earlier messages omitted` marker (spec §5.4) is part of the canvas plan's transcript work. It is deliberately not a `StreamEvent` — the count is a property of the request, not of the stream.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/stream-engine.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Wire the engine into IPC**

In `src/main/ipc/handlers.ts`, add a `registerChatHandlers(window: BrowserWindow)` that constructs a `SessionStore` at `join(app.getPath('userData'), 'sessions')` and a `StreamEngine` with:

```ts
const engine = new StreamEngine({
  emit: (envelope) => window.webContents.send(CHANNELS.chatEvent, envelope),
  readKey: (providerId) => keystore.read(providerId),
  store: sessionStore,
  resolveProvider: getProvider,
  fetch: mainFetch,
})

ipcMain.handle(CHANNELS.chatSend, (_e, raw: unknown) => engine.start(SendSchema.parse(raw)))
ipcMain.handle(CHANNELS.chatAbort, (_e, raw: unknown) => { engine.abort(AbortSchema.parse(raw).streamId) })
ipcMain.handle(CHANNELS.providersList, () => listProviders())
ipcMain.handle(CHANNELS.sessionsList, () => sessionStore.list())
ipcMain.handle(CHANNELS.sessionLoad, (_e, raw: unknown) => sessionStore.load(z.object({ id: z.string() }).parse(raw).id))
ipcMain.handle(CHANNELS.sessionCreate, (_e, raw: unknown) => sessionStore.create(z.object({ title: z.string() }).parse(raw).title))
ipcMain.handle(CHANNELS.sessionDelete, (_e, raw: unknown) => sessionStore.remove(z.object({ id: z.string() }).parse(raw).id))
ipcMain.handle(CHANNELS.modelsList, async (_e, raw: unknown) => {
  const { providerId, baseUrl } = z.object({ providerId: z.string(), baseUrl: z.string().optional() }).parse(raw)
  const apiKey = await keystore.read(providerId)
  if (!apiKey) return []
  return getProvider(providerId).listModels({ apiKey, ...(baseUrl ? { baseUrl } : {}), fetch: mainFetch })
})
```

Call `registerChatHandlers(window)` from `createWindow` in `src/main/index.ts`.

- [ ] **Step 6: Run typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: stream engine with streamId routing, abort, and persistence"
```

---

## Task 9: Renderer shell, layout, and splitter

**Files:**
- Create: `src/renderer/state/store.ts`, `src/renderer/app/App.tsx`, `src/renderer/app/Splitter.tsx`, `src/renderer/app/theme.css`
- Modify: `src/renderer/main.tsx`
- Test: `tests/e2e/layout.spec.ts`

**Interfaces:**
- Consumes: `window.openCoder` (Task 2)
- Produces: `useAppStore` (Zustand) exposing `sessions`, `activeSessionId`, `messages`, `streamId`, `error`, `providerId`, `model`, `baseUrl`, plus actions `loadSessions()`, `selectSession(id)`, `newSession()`, `send(content)`, `stop()`, `setProvider(id)`, `setModel(id)`. `<Splitter onResize={(deltaPx: number) => void} />`

- [ ] **Step 1: Write the failing E2E test**

`tests/e2e/layout.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeAll(async () => { app = await launchApp() })
test.afterAll(async () => { await app.close() })

test('renders the sidebar and composer', async () => {
  const page = await app.firstWindow()
  await expect(page.getByTestId('sidebar')).toBeVisible()
  await expect(page.getByTestId('composer-input')).toBeVisible()
})

test('the splitter moves the sidebar boundary', async () => {
  const page = await app.firstWindow()
  const before = await page.getByTestId('sidebar').boundingBox()
  const handle = page.getByTestId('splitter')
  const box = await handle.boundingBox()
  if (!box || !before) throw new Error('missing layout boxes')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  const after = await page.getByTestId('sidebar').boundingBox()
  expect(after?.width ?? 0).toBeGreaterThan(before.width + 40)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e -- layout.spec.ts`
Expected: FAIL — no `sidebar` test id.

- [ ] **Step 3: Write the store**

`src/renderer/state/store.ts`:

```ts
import { create } from 'zustand'
import type { ChatMessage, ProviderError } from '@shared/types'

interface SessionMeta { id: string; title: string; updatedAt: number }

interface AppState {
  sessions: SessionMeta[]
  activeSessionId: string | null
  messages: ChatMessage[]
  streamId: string | null
  streamingText: string
  error: ProviderError | null
  providerId: string
  model: string
  baseUrl: string | undefined
  sidebarWidth: number
  settingsOpen: boolean

  openSettings(): void
  closeSettings(): void
  loadSessions(): Promise<void>
  selectSession(id: string): Promise<void>
  newSession(): Promise<void>
  send(content: string): Promise<void>
  stop(): Promise<void>
  setProvider(id: string): void
  setModel(id: string): void
  setSidebarWidth(px: number): void
  applyEvent(envelope: { streamId: string; sessionId: string; event: import('@shared/types').StreamEvent }): void
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  streamId: null,
  streamingText: '',
  error: null,
  providerId: 'kimi',
  model: '',
  baseUrl: undefined,
  sidebarWidth: 260,
  settingsOpen: false,

  openSettings() { set({ settingsOpen: true }) },
  closeSettings() { set({ settingsOpen: false }) },

  async loadSessions() {
    set({ sessions: await window.openCoder.sessions.list() })
  },

  async selectSession(id) {
    set({ activeSessionId: id, messages: await window.openCoder.sessions.load(id), error: null })
  },

  async newSession() {
    const { id } = await window.openCoder.sessions.create('New chat')
    await get().loadSessions()
    await get().selectSession(id)
  },

  async send(content) {
    let sessionId = get().activeSessionId
    if (!sessionId) { await get().newSession(); sessionId = get().activeSessionId }
    if (!sessionId) return
    set((s) => ({
      error: null,
      streamingText: '',
      messages: [...s.messages, {
        id: `local-${Date.now()}`, role: 'user', content, createdAt: Date.now(),
      }],
    }))
    const { streamId } = await window.openCoder.chat.send({
      sessionId,
      providerId: get().providerId,
      model: get().model,
      ...(get().baseUrl ? { baseUrl: get().baseUrl } : {}),
      content,
    })
    set({ streamId })
  },

  async stop() {
    const id = get().streamId
    if (id) await window.openCoder.chat.abort(id)
    set({ streamId: null })
  },

  setProvider(id) { set({ providerId: id, model: '' }) },
  setModel(id) { set({ model: id }) },
  setSidebarWidth(px) { set({ sidebarWidth: Math.min(480, Math.max(180, px)) }) },

  // Chunks from a superseded or aborted stream are discarded by streamId.
  applyEvent({ streamId, event }) {
    if (streamId !== get().streamId) return
    if (event.type === 'text') { set((s) => ({ streamingText: s.streamingText + event.delta })); return }
    if (event.type === 'error') { set({ error: event.error, streamId: null }); return }
    if (event.type === 'done') {
      set((s) => ({
        streamId: null,
        streamingText: '',
        messages: [...s.messages, {
          id: `local-a-${Date.now()}`, role: 'assistant',
          content: s.streamingText, createdAt: Date.now(),
        }],
      }))
    }
  },
}))
```

- [ ] **Step 4: Write the splitter**

`src/renderer/app/Splitter.tsx`:

```tsx
import { useRef } from 'react'

interface Props { onResize(clientX: number): void }

/**
 * Pointer capture keeps every move event on this element even when the
 * pointer crosses another pane, so a drag cannot be lost mid-gesture.
 */
export function Splitter({ onResize }: Props): React.JSX.Element {
  const dragging = useRef(false)

  return (
    <div
      data-testid="splitter"
      role="separator"
      aria-orientation="vertical"
      className="splitter"
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.classList.add('resizing')
      }}
      onPointerMove={(e) => { if (dragging.current) onResize(e.clientX) }}
      onPointerUp={(e) => {
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
        document.body.classList.remove('resizing')
      }}
    />
  )
}
```

- [ ] **Step 5: Write the app shell and theme**

`src/renderer/app/App.tsx`:

```tsx
import { useEffect } from 'react'
import { useAppStore } from '../state/store.js'
import { Splitter } from './Splitter.js'
import { Sidebar } from '../sessions/Sidebar.js'

export function App(): React.JSX.Element {
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)
  const loadSessions = useAppStore((s) => s.loadSessions)
  const applyEvent = useAppStore((s) => s.applyEvent)

  useEffect(() => { void loadSessions() }, [loadSessions])
  useEffect(() => window.openCoder.chat.onEvent(applyEvent), [applyEvent])

  return (
    <div className="app" style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` }}>
      <Sidebar />
      <Splitter onResize={setSidebarWidth} />
      <main className="chat">
        {/* Placeholders. Task 10 replaces this block with <Transcript /> and <Composer />. */}
        <div data-testid="transcript" className="transcript" />
        <div className="composer">
          <textarea data-testid="composer-input" rows={3} placeholder="Ask anything" readOnly />
        </div>
      </main>
    </div>
  )
}
```

`src/renderer/app/theme.css`:

```css
:root {
  --bg: #101014;
  --bg-raised: #17171d;
  --border: #26262f;
  --text: #e6e6ec;
  --text-dim: #9a9aa8;
  --accent: #6b8afd;
  --danger: #ff6b6b;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
.app { display: grid; grid-template-columns: var(--sidebar-width) 4px 1fr; height: 100vh; }
.splitter { cursor: col-resize; background: var(--border); }
.splitter:hover { background: var(--accent); }
body.resizing { cursor: col-resize; user-select: none; }
.chat { display: flex; flex-direction: column; min-width: 0; }
```

Update `src/renderer/main.tsx` to import `./app/theme.css` and render `<App />`.

- [ ] **Step 6: Write the sidebar**

`src/renderer/sessions/Sidebar.tsx`:

```tsx
import { useAppStore } from '../state/store.js'

export function Sidebar(): React.JSX.Element {
  const sessions = useAppStore((s) => s.sessions)
  const activeId = useAppStore((s) => s.activeSessionId)
  const select = useAppStore((s) => s.selectSession)
  const create = useAppStore((s) => s.newSession)

  return (
    <aside data-testid="sidebar" className="sidebar">
      <button data-testid="new-session" onClick={() => void create()}>New chat</button>
      <ul>
        {sessions.map((s) => (
          <li key={s.id}>
            <button
              aria-current={s.id === activeId}
              onClick={() => void select(s.id)}
            >{s.title}</button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run test:e2e -- layout.spec.ts`
Expected: PASS — both layout tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: renderer shell, zustand store, and pointer-capture splitter"
```

---

## Task 10: Transcript, composer, auto-scroll, and error notices

**Files:**
- Create: `src/renderer/chat/Transcript.tsx`, `src/renderer/chat/MessageView.tsx`, `src/renderer/chat/Composer.tsx`, `src/renderer/chat/ErrorNotice.tsx`, `src/renderer/chat/useAutoScroll.ts`
- Test: `tests/e2e/chat.spec.ts`

**Interfaces:**
- Consumes: `useAppStore` (Task 9), `ProviderError` (Task 2)
- Produces: `useAutoScroll(dep: unknown): React.RefObject<HTMLDivElement | null>`

- [ ] **Step 1: Add a fake provider for deterministic E2E**

In `src/main/providers/registry.ts`, prepend a fake provider when `process.env['OPEN_CODER_FAKE_PROVIDER'] === '1'`, so it becomes the first entry and therefore the renderer's default selection:

```ts
const fakeProvider: Provider = {
  id: 'fake', label: 'Fake (test)', defaultBaseUrl: 'http://localhost', requiresKey: false,
  listModels: async () => [{ id: 'fake-1', label: 'fake-1', contextWindow: 8000 }],
  async *streamChat(_req, signal) {
    for (const word of ['Hello', ' from', ' the', ' fake', ' provider']) {
      if (signal.aborted) return
      await new Promise((r) => setTimeout(r, 20))
      yield { type: 'text' as const, delta: word }
    }
    yield { type: 'done' as const }
  },
}

const providers: Provider[] = [
  ...(process.env['OPEN_CODER_FAKE_PROVIDER'] === '1' ? [fakeProvider] : []),
  createOpenAiCompatProvider({ id: 'kimi', /* …unchanged… */ }),
  // …the rest, unchanged
]
```

The fake declares `requiresKey: false`, so the engine's guard from Task 8 lets it through without a stored key. No engine change is needed.

Then add a `loadProviders()` action to the store from Task 9, called from `App`'s mount effect alongside `loadSessions()`. It selects the first provider and its first model when nothing is chosen yet, which is what makes the fake the active provider under the test env var — with no test-only code in the shipped renderer:

```ts
  async loadProviders() {
    const list = await window.openCoder.providers.list()
    set({ providers: list })
    const current = get().providerId
    if (!current || !list.some((p) => p.id === current)) {
      const first = list[0]
      if (!first) return
      set({ providerId: first.id })
      const models = await window.openCoder.providers.models(first.id).catch(() => [])
      if (models[0]) set({ model: models[0].id })
    }
  },
```

Add `providers: { id: string; label: string }[]` to the store's state, initialized to `[]`, and change the initial `providerId` from `'kimi'` to `''` so the selection above always runs.

- [ ] **Step 2: Write the failing E2E test**

`tests/e2e/chat.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeAll(async () => { app = await launchApp({ OPEN_CODER_FAKE_PROVIDER: '1' }) })
test.afterAll(async () => { await app.close() })

test('streams a reply into the transcript', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  await page.getByTestId('composer-input').fill('hi there')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('transcript')).toContainText('hi there')
  await expect(page.getByTestId('transcript')).toContainText('Hello from the fake provider', { timeout: 10_000 })
})

test('stopping mid-stream marks the reply incomplete', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  await page.getByTestId('composer-input').fill('second turn')
  await page.getByTestId('composer-send').click()
  await page.getByTestId('composer-stop').click()
  await expect(page.getByTestId('composer-send')).toBeVisible()
})
```

The fake provider is first in the registry under `OPEN_CODER_FAKE_PROVIDER=1`, so `loadProviders()` selects it on mount. No test-only code exists in the renderer.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:e2e -- chat.spec.ts`
Expected: FAIL — no `composer-input`.

- [ ] **Step 4: Write the auto-scroll hook**

`src/renderer/chat/useAutoScroll.ts`:

```ts
import { useEffect, useRef } from 'react'

/**
 * Follows new content, but disengages the moment the user scrolls up
 * and re-engages when they return to within 40px of the bottom.
 */
export function useAutoScroll(dep: unknown): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)
  const pinned = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll) }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [dep])

  return ref
}
```

- [ ] **Step 5: Write the message view, transcript, error notice, and composer**

`src/renderer/chat/MessageView.tsx`:

```tsx
import { memo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatMessage } from '@shared/types'

/**
 * Model output is attacker-influenceable (prompt injection via pasted
 * content), so markdown HTML is sanitized before injection. The renderer's
 * CSP is a second layer, not the only one.
 */
function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, { async: false }), {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'srcset', 'formaction'],
  })
}

/** Memoized so a streaming append re-renders only the in-flight message. */
export const MessageView = memo(function MessageView({ message }: { message: ChatMessage }) {
  return (
    <article className={`msg msg-${message.role}`}>
      <div className="msg-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
      {message.incomplete ? <p className="msg-incomplete">Stopped before completion.</p> : null}
    </article>
  )
})
```

Add a unit test at `tests/unit/render-markdown.test.ts` proving the sanitizer holds. Export `renderMarkdown` from the module, and configure Vitest to run it in a DOM environment by adding `// @vitest-environment jsdom` at the top of the file (add `jsdom` to devDependencies as `27.0.0`):

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/renderer/chat/MessageView.js'

describe('renderMarkdown', () => {
  it('keeps ordinary formatting', () => {
    expect(renderMarkdown('**bold** and `code`')).toContain('<strong>bold</strong>')
  })
  it('strips script tags', () => {
    expect(renderMarkdown('<script>alert(1)</script>hi')).not.toContain('<script')
  })
  it('strips inline event handlers', () => {
    expect(renderMarkdown('<img src=x onerror="alert(1)">')).not.toContain('onerror')
  })
  it('strips javascript: urls', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('javascript:')
  })
  it('strips style tags used for exfiltration', () => {
    expect(renderMarkdown('<style>body{background:url(http://evil)}</style>')).not.toContain('<style')
  })
})
```

Extend `vitest.config.ts`'s `include` to `['tests/unit/**/*.test.ts']` (already correct) — the per-file environment comment handles the DOM.

`src/renderer/chat/ErrorNotice.tsx`:

```tsx
import type { ProviderError } from '@shared/types'

const ACTION_LABEL: Record<ProviderError['kind'], string | null> = {
  auth: 'Open settings',
  rate_limit: 'Retry',
  context_overflow: 'Retry with fewer messages',
  network: 'Retry',
  provider_5xx: 'Retry',
  aborted: null,
  unknown: 'Retry',
}

interface Props { error: ProviderError; onAction(kind: ProviderError['kind']): void }

export function ErrorNotice({ error, onAction }: Props): React.JSX.Element | null {
  const label = ACTION_LABEL[error.kind]
  if (error.kind === 'aborted') return null
  return (
    <div data-testid="error-notice" className="error-notice" role="alert">
      <span>{error.message}</span>
      {error.retryAfterSeconds ? <span> Try again in {error.retryAfterSeconds}s.</span> : null}
      {label ? (
        <button data-testid="error-action" onClick={() => onAction(error.kind)}>{label}</button>
      ) : null}
    </div>
  )
}
```

`src/renderer/chat/Transcript.tsx`:

```tsx
import { useAppStore } from '../state/store.js'
import { MessageView } from './MessageView.js'
import { ErrorNotice } from './ErrorNotice.js'
import { useAutoScroll } from './useAutoScroll.js'

export function Transcript(): React.JSX.Element {
  const messages = useAppStore((s) => s.messages)
  const streamingText = useAppStore((s) => s.streamingText)
  const error = useAppStore((s) => s.error)
  const openSettings = useAppStore((s) => s.openSettings)
  const ref = useAutoScroll(messages.length + streamingText.length)

  return (
    <div data-testid="transcript" className="transcript" ref={ref}>
      {messages.map((m) => <MessageView key={m.id} message={m} />)}
      {streamingText ? (
        <MessageView message={{ id: 'streaming', role: 'assistant', content: streamingText, createdAt: 0 }} />
      ) : null}
      {error ? (
        <ErrorNotice
          error={error}
          onAction={(kind) => { if (kind === 'auth') openSettings() }}
        />
      ) : null}
    </div>
  )
}
```

Then replace the placeholder block in `src/renderer/app/App.tsx` with `<Transcript />` and `<Composer />`, importing both. `settingsOpen`, `openSettings`, and `closeSettings` already exist in the store from Task 9.

`src/renderer/chat/Composer.tsx`:

```tsx
import { useState } from 'react'
import { useAppStore } from '../state/store.js'

export function Composer(): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const streaming = useAppStore((s) => s.streamId !== null)
  const send = useAppStore((s) => s.send)
  const stop = useAppStore((s) => s.stop)

  const submit = () => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    void send(text)
  }

  return (
    <div className="composer">
      <textarea
        data-testid="composer-input"
        value={draft}
        rows={3}
        placeholder="Ask anything"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        }}
      />
      {streaming
        ? <button data-testid="composer-stop" onClick={() => void stop()}>Stop</button>
        : <button data-testid="composer-send" onClick={submit}>Send</button>}
    </div>
  )
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:e2e -- chat.spec.ts`
Expected: PASS — streaming text appears, and the missing-key case offers *Open settings*.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: streaming transcript, composer, auto-scroll, and error recovery actions"
```

---

## Task 11: Settings dialog

**Files:**
- Create: `src/renderer/settings/SettingsDialog.tsx`
- Modify: `src/renderer/app/App.tsx`, `src/renderer/state/store.ts`
- Test: `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `window.openCoder.providers`, `window.openCoder.keys`, `useAppStore`
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Write the failing E2E test**

`tests/e2e/settings.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeAll(async () => { app = await launchApp() })
test.afterAll(async () => { await app.close() })

test('stores a key and reports it as configured without revealing it', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('open-settings').click()
  await page.getByTestId('provider-select').selectOption('kimi')
  await page.getByTestId('api-key-input').fill('sk-test-value-123')
  await page.getByTestId('api-key-save').click()
  await expect(page.getByTestId('key-status')).toHaveText('Configured')
  await expect(page.getByTestId('api-key-input')).toHaveValue('')
})

test('offers a recovery action when the selected provider has no key', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('open-settings').click()
  // deepseek is deliberately a provider the previous test did not configure.
  await page.getByTestId('provider-select').selectOption('deepseek')
  await expect(page.getByTestId('key-status')).toHaveText('Not configured')
  await page.getByTestId('settings-close').click()
  await page.getByTestId('new-session').click()
  await page.getByTestId('composer-input').fill('hello')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('error-action')).toHaveText('Open settings')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e -- settings.spec.ts`
Expected: FAIL — no `open-settings` button.

- [ ] **Step 3: Write the dialog**

`src/renderer/settings/SettingsDialog.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store.js'
import type { ModelInfo } from '@shared/types'

export function SettingsDialog(): React.JSX.Element | null {
  const open = useAppStore((s) => s.settingsOpen)
  const close = useAppStore((s) => s.closeSettings)
  const providerId = useAppStore((s) => s.providerId)
  const setProvider = useAppStore((s) => s.setProvider)
  const model = useAppStore((s) => s.model)
  const setModel = useAppStore((s) => s.setModel)

  const [providers, setProviders] = useState<{ id: string; label: string }[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [draftKey, setDraftKey] = useState('')
  const [configured, setConfigured] = useState(false)

  useEffect(() => {
    if (open) void window.openCoder.providers.list().then(setProviders)
  }, [open])

  useEffect(() => {
    void window.openCoder.keys.has(providerId).then(setConfigured)
    void window.openCoder.providers.models(providerId).then(setModels).catch(() => setModels([]))
  }, [providerId, open])

  if (!open) return null

  const save = async () => {
    await window.openCoder.keys.set(providerId, draftKey)
    setDraftKey('')
    setConfigured(await window.openCoder.keys.has(providerId))
    setModels(await window.openCoder.providers.models(providerId).catch(() => []))
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-label="Settings">
      <div className="dialog">
        <h2>Settings</h2>

        <label htmlFor="provider">Provider</label>
        <select
          id="provider" data-testid="provider-select" value={providerId}
          onChange={(e) => setProvider(e.target.value)}
        >
          {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>

        <label htmlFor="apikey">API key</label>
        <input
          id="apikey" data-testid="api-key-input" type="password" value={draftKey}
          placeholder={configured ? 'A key is stored. Enter a new one to replace it.' : 'Paste your key'}
          onChange={(e) => setDraftKey(e.target.value)}
        />
        <span data-testid="key-status">{configured ? 'Configured' : 'Not configured'}</span>
        <button data-testid="api-key-save" disabled={draftKey.length === 0} onClick={() => void save()}>
          Save key
        </button>
        <button
          data-testid="api-key-delete"
          disabled={!configured}
          onClick={() => void window.openCoder.keys.delete(providerId).then(() => setConfigured(false))}
        >Remove key</button>

        <label htmlFor="model">Model</label>
        <select id="model" data-testid="model-select" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Select a model</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>

        <button data-testid="settings-close" onClick={close}>Done</button>
      </div>
    </div>
  )
}
```

Render `<SettingsDialog />` in `App.tsx`, and add a `data-testid="open-settings"` button to `Sidebar.tsx` that calls `openSettings()`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:e2e -- settings.spec.ts`
Expected: PASS — the input clears after save and the status reads *Configured*, proving the key was never read back.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: settings dialog for provider, key, and model selection"
```

---

## Task 12: Anthropic provider

**Files:**
- Create: `src/main/providers/anthropic.ts`, `tests/fixtures/anthropic.ts`
- Modify: `src/main/providers/registry.ts`
- Test: `tests/unit/anthropic.test.ts`

**Interfaces:**
- Consumes: `Provider`/`ProviderConfig` (Task 5), `parseSse` (Task 4), `runProviderContract` (Task 5), `statusToError` (Task 5)
- Produces: `createAnthropicProvider(): Provider` with `id: 'anthropic'`

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/anthropic.ts`:

```ts
import type { ContractFixtures } from '../contract/provider-contract.js'

const delta = (text: string) =>
  `event: content_block_delta\ndata: ${JSON.stringify({
    type: 'content_block_delta', delta: { type: 'text_delta', text },
  })}\n\n`

export const anthropicFixtures: ContractFixtures = {
  helloStream:
    `event: message_start\ndata: ${JSON.stringify({ type: 'message_start' })}\n\n` +
    delta('Hello') + delta(' world') +
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  authErrorBody: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }),
  rateLimitBody: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }),
}
```

- [ ] **Step 2: Write the failing test**

`tests/unit/anthropic.test.ts`:

```ts
import { runProviderContract } from '../contract/provider-contract.js'
import { anthropicFixtures } from '../fixtures/anthropic.js'
import { createAnthropicProvider } from '../../src/main/providers/anthropic.js'

runProviderContract('anthropic', createAnthropicProvider, anthropicFixtures)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/anthropic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the provider**

`src/main/providers/anthropic.ts`:

```ts
import { parseSse } from '../chat/sse-parser.js'
import { statusToError } from './openai-compat.js'
import type { ChatRequest, Provider, ProviderConfig } from './types.js'
import type { ModelInfo, StreamEvent } from '../../shared/types.js'

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'

export function createAnthropicProvider(): Provider {
  const urlFor = (config: ProviderConfig, path: string) =>
    `${(config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}${path}`

  const headers = (config: ProviderConfig) => ({
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  })

  return {
    id: 'anthropic',
    label: 'Anthropic',
    defaultBaseUrl: DEFAULT_BASE_URL,
    requiresKey: true,

    async listModels(config) {
      const response = await config.fetch(urlFor(config, '/models'), { headers: headers(config) })
      if (!response.ok) return []
      const body = (await response.json()) as { data?: { id?: string; display_name?: string }[] }
      return (body.data ?? [])
        .filter((m): m is { id: string; display_name?: string } => typeof m.id === 'string')
        .map((m): ModelInfo => ({ id: m.id, label: m.display_name ?? m.id, contextWindow: 200_000 }))
    },

    async *streamChat(request: ChatRequest, signal: AbortSignal) {
      const { config } = request
      // Anthropic takes the system prompt as a top-level field, not a message.
      const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
      const turns = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }))

      let response: Response
      try {
        response = await config.fetch(urlFor(config, '/messages'), {
          method: 'POST',
          signal,
          headers: headers(config),
          body: JSON.stringify({
            model: request.model,
            max_tokens: 8192,
            stream: true,
            ...(system ? { system } : {}),
            messages: turns,
          }),
        })
      } catch {
        if (signal.aborted) { yield { type: 'done' } satisfies StreamEvent; return }
        yield { type: 'error', error: { kind: 'network', message: 'Could not reach the provider.' } }
        return
      }

      if (!response.ok) {
        yield { type: 'error', error: statusToError(response.status, response.headers.get('retry-after')) }
        return
      }
      if (!response.body) {
        yield { type: 'error', error: { kind: 'network', message: 'The provider returned an empty body.' } }
        return
      }

      const decoder = new TextDecoder()
      const reader = response.body.getReader()
      let residual = ''

      try {
        for (;;) {
          if (signal.aborted) break
          const { done, value } = await reader.read()
          if (done) break

          const parsed = parseSse(decoder.decode(value, { stream: true }), residual)
          residual = parsed.residual

          for (const record of parsed.events) {
            let payload: {
              type?: string
              delta?: { type?: string; text?: string; thinking?: string }
              error?: { message?: string }
            }
            try { payload = JSON.parse(record.data) } catch { continue }

            if (payload.type === 'error') {
              yield { type: 'error', error: { kind: 'unknown', message: 'The provider reported an error.' } }
              return
            }
            if (payload.type === 'message_stop') { yield { type: 'done' }; return }
            if (payload.delta?.type === 'thinking_delta' && payload.delta.thinking) {
              yield { type: 'reasoning', delta: payload.delta.thinking }
            }
            if (payload.delta?.type === 'text_delta' && payload.delta.text) {
              yield { type: 'text', delta: payload.delta.text }
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined)
      }

      yield { type: 'done' }
    },
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/anthropic.test.ts`
Expected: PASS — the same 9 contract tests.

- [ ] **Step 6: Register it**

Add `createAnthropicProvider()` to the `providers` array in `src/main/providers/registry.ts`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: anthropic provider passing the shared contract suite"
```

---

## Task 13: Ollama provider

**Files:**
- Create: `src/main/providers/ollama.ts`, `tests/fixtures/ollama.ts`
- Modify: `src/main/providers/registry.ts`
- Test: `tests/unit/ollama.test.ts`

**Interfaces:**
- Consumes: `Provider`/`ProviderConfig` (Task 5), `statusToError` (Task 5)
- Produces: `createOllamaProvider(): Provider` with `id: 'ollama'`

Ollama streams newline-delimited JSON rather than SSE, so this provider does not use `parseSse`. It is included precisely because it proves the `Provider` abstraction is not secretly SSE-shaped.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/ollama.ts`:

```ts
import type { ContractFixtures } from '../contract/provider-contract.js'

const line = (content: string, done = false) =>
  `${JSON.stringify({ message: { role: 'assistant', content }, done })}\n`

export const ollamaFixtures: ContractFixtures = {
  helloStream: line('Hello') + line(' world') + line('', true),
  authErrorBody: JSON.stringify({ error: 'unauthorized' }),
  rateLimitBody: JSON.stringify({ error: 'too many requests' }),
}
```

- [ ] **Step 2: Write the failing test**

`tests/unit/ollama.test.ts`:

```ts
import { runProviderContract } from '../contract/provider-contract.js'
import { ollamaFixtures } from '../fixtures/ollama.js'
import { createOllamaProvider } from '../../src/main/providers/ollama.js'

runProviderContract('ollama', createOllamaProvider, ollamaFixtures)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/ollama.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the provider**

`src/main/providers/ollama.ts`:

```ts
import { statusToError } from './openai-compat.js'
import type { ChatRequest, Provider, ProviderConfig } from './types.js'
import type { ModelInfo, StreamEvent } from '../../shared/types.js'

const DEFAULT_BASE_URL = 'http://localhost:11434'

export function createOllamaProvider(): Provider {
  const urlFor = (config: ProviderConfig, path: string) =>
    `${(config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}${path}`

  return {
    id: 'ollama',
    label: 'Ollama (local)',
    defaultBaseUrl: DEFAULT_BASE_URL,
    requiresKey: false,

    async listModels(config) {
      const response = await config.fetch(urlFor(config, '/api/tags'), {})
      if (!response.ok) return []
      const body = (await response.json()) as { models?: { name?: string }[] }
      return (body.models ?? [])
        .filter((m): m is { name: string } => typeof m.name === 'string')
        .map((m): ModelInfo => ({ id: m.name, label: m.name, contextWindow: 32_000 }))
    },

    async *streamChat(request: ChatRequest, signal: AbortSignal) {
      const { config } = request
      let response: Response
      try {
        response = await config.fetch(urlFor(config, '/api/chat'), {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: request.model,
            stream: true,
            messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        })
      } catch {
        if (signal.aborted) { yield { type: 'done' } satisfies StreamEvent; return }
        yield {
          type: 'error',
          error: { kind: 'network', message: 'Could not reach Ollama. Is it running?' },
        }
        return
      }

      if (!response.ok) {
        yield { type: 'error', error: statusToError(response.status, response.headers.get('retry-after')) }
        return
      }
      if (!response.body) {
        yield { type: 'error', error: { kind: 'network', message: 'Ollama returned an empty body.' } }
        return
      }

      const decoder = new TextDecoder()
      const reader = response.body.getReader()
      let residual = ''

      try {
        for (;;) {
          if (signal.aborted) break
          const { done, value } = await reader.read()
          if (done) break

          residual += decoder.decode(value, { stream: true })
          const lines = residual.split('\n')
          residual = lines.pop() ?? ''

          for (const raw of lines) {
            if (raw.trim() === '') continue
            let payload: { message?: { content?: string }; done?: boolean }
            try { payload = JSON.parse(raw) } catch { continue }
            if (payload.message?.content) yield { type: 'text', delta: payload.message.content }
            if (payload.done === true) { yield { type: 'done' }; return }
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined)
      }

      yield { type: 'done' }
    },
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/ollama.test.ts`
Expected: PASS — the same 9 contract tests against an NDJSON transport.

- [ ] **Step 6: Register it**

Add `createOllamaProvider()` to the `providers` array in `src/main/providers/registry.ts`.

- [ ] **Step 7: Run the whole suite**

Run: `npm test && npm run typecheck && npm run test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: ollama provider over ndjson, proving the abstraction is transport-agnostic"
```

---

## Task 14: Repository, CI, and contributor on-ramp

The provider interface is the designed-for contribution. This task makes that path discoverable.

**Files:**
- Create: `LICENSE`, `README.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml`
- Create: `docs/adr/0001-electron-over-tauri.md`, `docs/adr/0002-react-renderer.md`, `docs/adr/0003-byo-key-no-session-scraping.md`, `docs/adr/0004-provider-contract-suite.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Add the Apache-2.0 license**

Write the verbatim Apache License 2.0 text to `LICENSE`. Set the copyright line to the current year and the project name.

- [ ] **Step 2: Write the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - name: E2E (Linux needs a virtual display)
        run: xvfb-run --auto-servernum npm run test:e2e
        if: matrix.os == 'ubuntu-latest'
      - run: npm run test:e2e
        if: matrix.os != 'ubuntu-latest'
```

- [ ] **Step 3: Write the four ADRs**

Each ADR follows the same shape — Context, Decision, Consequences — and records what was rejected and why. Content comes from spec §2:

- `0001-electron-over-tauri.md`: bundled Chromium guarantees identical rendering across platforms, which matters because the artifact canvas is the product differentiator. Rejected Tauri: OS webview divergence, notably WebKitGTK on Linux, plus a Rust-only contributor pool. Cost accepted: ~150 MB installers.
- `0002-react-renderer.md`: contributor pool size dominates for an OSS side project; TypeScript types the IPC contract end-to-end. Rejected hand-rolled DOM rendering: forces every contributor to learn bespoke conventions before landing a change.
- `0003-byo-key-no-session-scraping.md`: rejected embedded-webview session capture as brittle, vendor-specific, contrary to provider terms of service, and a liability in a public repository.
- `0004-provider-contract-suite.md`: one shared suite every provider passes, so a stranger's provider PR verifies itself and can be merged without hand-auditing streaming logic.

- [ ] **Step 4: Write `CONTRIBUTING.md` with the flagship on-ramp**

The headline section is *Add a provider in 20 minutes*, and it must be a complete worked example, not a description:

1. Copy `src/main/providers/ollama.ts` to `src/main/providers/<yours>.ts`.
2. Implement `listModels` and `streamChat`. Yield `{ type: 'text', delta }` per token, exactly one `{ type: 'done' }` last, and `{ type: 'error', error }` instead of throwing. Map HTTP status with `statusToError`. Never put the API key in an error message.
3. Add fixtures at `tests/fixtures/<yours>.ts` implementing `ContractFixtures`: a stream that produces exactly `Hello world`, a 401 body, and a 429 body.
4. Add `tests/unit/<yours>.test.ts` with three lines: import `runProviderContract`, import your fixtures and factory, call `runProviderContract('<yours>', create<Yours>Provider, <yours>Fixtures)`.
5. Register it in `src/main/providers/registry.ts`.
6. Run `npm test`. Nine contract tests must pass.

Also document: Node >= 22.19.0, `npm run dev`, the commit convention, and the rule that no API key may reach the renderer.

- [ ] **Step 5: Write `README.md`**

Cover: the one-line positioning (*watch it build, see it render — against any model, without an IDE*), a screenshot placeholder, supported providers, quick start (`npm ci`, `npm run dev`, paste a key in Settings), the security model summary from spec §3.1, current status (v0: chat and providers; canvas in progress), and the Apache-2.0 notice.

- [ ] **Step 6: Verify CI passes locally**

Run: `npm ci && npm run typecheck && npm test && npm run test:e2e`
Expected: PASS on all four.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: apache-2.0 license, ci across three platforms, adrs, and contributor on-ramp"
```

---

## Self-Review Notes

**Spec coverage.** §3.1 trust boundary → Tasks 1–3. §3.2 window config → Task 1. §3.3 module layout → all. §4 provider layer → Tasks 5, 12, 13. §4.4 key storage → Task 3. §5.1–5.2 streaming and `streamId` → Task 8. §5.3 SSE parsing → Task 4. §5.4 context budgeting → Task 6. §5.5 cancellation → Task 8. §7.1–7.2 layout and splitter → Task 9. §7.3 transcript → Task 10. §7.4 error taxonomy → Task 10. §8 persistence → Task 7. §9.1 unit tests → Tasks 3, 4, 6, 7, 8. §9.2 contract suite → Task 5. §9.3 E2E → Tasks 9, 10. §9.4 security invariants → Tasks 1, 3. §10 repo and community → Task 14.

**Deliberately deferred to the canvas plan:** spec §6 in full, and the visible `⋯ N earlier messages omitted` transcript marker from §5.4 — `applyContextBudget` returns `omittedCount` and is tested here, but rendering it belongs with the transcript work that the canvas plan extends.

**Known follow-ups** to file as issues rather than fold into this plan: sanitizing model-authored markdown beyond the CSP (Task 10), syntax highlighting for code blocks, and per-model context windows replacing the fixed 96k default in Task 8.
