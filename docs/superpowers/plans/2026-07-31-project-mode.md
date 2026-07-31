# Project Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Modelith usable for project-level coding — the agent can search file contents, one approval can cover the rest of a turn, and opening a folder is obvious and persistent.

**Architecture:** Three independent additions on top of the existing confined workspace + gated tool loop: (1) a `search_files` read-only tool reusing the confined tree walk; (2) a per-turn "trust" flag in the stream engine that short-circuits the approval gate for the current turn only, keeping full checkpoint/revert; (3) a renderer project panel that renders the existing flat `TreeEntry[]` as a collapsible tree with a prominent open-folder entry point.

**Tech Stack:** Electron main (Node ESM, TypeScript strict), React 19 renderer, Zustand store, Vitest (unit), Playwright electron (e2e). Provider-agnostic tool-calling loop.

## Global Constraints

- TypeScript strict; ESM everywhere; **relative imports must carry the `.js` extension** (e.g. `./tools.js`).
- Renderer reaches main only through `window.modelith.*` (contextBridge). No new IPC channels unless stated; reuse `chat:tool-decision`.
- **Security invariants must not regress:** every read/write stays confined to the dialog-chosen root (realpath + `isInsideRoot`); every write goes through `Workspace.applyWrite` so a per-turn checkpoint pre-image is recorded; `search_files` is read-only.
- Trust is **per-turn, in-memory only** — never persisted, never spans turns/sessions.
- Commit messages: **do NOT** add a `Co-Authored-By: Claude` trailer.
- Unit tests: `tests/unit/*.test.ts` (vitest). E2E: `tests/e2e/*.spec.ts` (Playwright, launched with `MODELITH_FAKE_PROVIDER: '1'`).
- Run unit tests with `npm run test:unit`; a single file with `npx vitest run tests/unit/<file>`.

---

### Task 1: `Workspace.search()` — confined content search (main)

**Files:**
- Modify: `src/main/workspace/service.ts` (add `SearchHit`/`SearchResult` types + `search` method)
- Test: `tests/unit/workspace-search.test.ts` (create)

**Interfaces:**
- Consumes: existing `Workspace.tree()` (returns `TreeEntry[]` with `relPath`, `kind`, `readable`) and `Workspace.read(relPath)` (confined; throws `WorkspaceError` for binary/too-large/outside-root).
- Produces:
  ```ts
  export interface SearchHit { relPath: string; line: number; text: string }
  export interface SearchResult { hits: SearchHit[]; truncated: boolean; filesScanned: number }
  // on class Workspace:
  search(query: string, opts?: { maxHits?: number }): Promise<SearchResult>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/workspace-search.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Workspace } from '../../src/main/workspace/service.js'
import type { AppSettingsStore } from '../../src/main/settings/store.js'

function fakeSettings(root: string): AppSettingsStore {
  return { get: async () => ({ workspaceRoot: root }), set: async () => {} } as unknown as AppSettingsStore
}

let root: string
let ws: Workspace

beforeAll(async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'oc-search-'))
  root = path.join(base, 'project')
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'a.ts'), 'const needleValue = 1\nother line\n')
  await writeFile(path.join(root, 'src', 'b.ts'), 'no match here\nNEEDLEVALUE upper\n')
  await writeFile(path.join(root, 'bin.dat'), Buffer.from([0x00, 0x6e, 0x65, 0x65, 0x64, 0x00])) // "nee" around NULs
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(path.join(root, 'node_modules', 'pkg', 'i.js'), 'needleValue in deps')
  ws = new Workspace(fakeSettings(root), () => undefined)
})
afterAll(async () => { if (root) await rm(path.dirname(root), { recursive: true, force: true }) })

describe('Workspace.search', () => {
  it('finds a case-insensitive substring across files with line numbers', async () => {
    const res = await ws.search('needlevalue')
    const locations = res.hits.map((h) => `${h.relPath}:${h.line}`)
    expect(locations).toContain('src/a.ts:1')
    expect(locations).toContain('src/b.ts:2')
    expect(res.hits.find((h) => h.relPath === 'src/a.ts:'.slice(0, -1))?.text).toBeUndefined() // sanity
    expect(res.hits.find((h) => h.line === 1 && h.relPath === 'src/a.ts')?.text).toContain('needleValue')
  })

  it('prunes ignored directories (node_modules is never scanned)', async () => {
    const res = await ws.search('needlevalue')
    expect(res.hits.some((h) => h.relPath.includes('node_modules'))).toBe(false)
  })

  it('skips binary files', async () => {
    const res = await ws.search('nee')
    expect(res.hits.some((h) => h.relPath === 'bin.dat')).toBe(false)
  })

  it('caps hits and flags truncation', async () => {
    const res = await ws.search('e', { maxHits: 1 }) // 'e' is common
    expect(res.hits.length).toBe(1)
    expect(res.truncated).toBe(true)
  })

  it('returns no hits and does not throw for an empty query', async () => {
    const res = await ws.search('')
    expect(res.hits).toEqual([])
    expect(res.truncated).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/workspace-search.test.ts`
Expected: FAIL — `ws.search is not a function`.

- [ ] **Step 3: Implement `search` in `src/main/workspace/service.ts`**

Add the exported types near the top (after the `TreeEntry` re-export):

```ts
export interface SearchHit { relPath: string; line: number; text: string }
export interface SearchResult { hits: SearchHit[]; truncated: boolean; filesScanned: number }
```

Add a constant near `MAX_ENTRIES`:

```ts
/** Default ceiling on returned search hits, and per-line text length. */
const MAX_SEARCH_HITS = 200
const MAX_HIT_TEXT = 200
```

Add the method to the `Workspace` class (after `tree()`):

```ts
/**
 * Case-insensitive substring search over file CONTENTS under the root. Reuses
 * `tree()` (already confined + ignore-pruned + capped) for the file list and
 * `read()` (confined + binary/size-guarded) for contents, so it inherits every
 * confinement guarantee and never scans outside the root.
 */
async search(query: string, opts?: { maxHits?: number }): Promise<SearchResult> {
  const needle = query.toLowerCase()
  if (!needle) return { hits: [], truncated: false, filesScanned: 0 }
  const maxHits = opts?.maxHits ?? MAX_SEARCH_HITS
  const files = (await this.tree()).filter((e) => e.kind === 'file' && e.readable)
  const hits: SearchHit[] = []
  let filesScanned = 0
  for (const f of files) {
    if (hits.length >= maxHits) return { hits, truncated: true, filesScanned }
    let text: string
    try {
      ({ text } = await this.read(f.relPath))
    } catch {
      continue // binary/too-large/unreadable — skip, never fail the whole search
    }
    filesScanned++
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(needle)) {
        hits.push({ relPath: f.relPath, line: i + 1, text: lines[i]!.trim().slice(0, MAX_HIT_TEXT) })
        if (hits.length >= maxHits) return { hits, truncated: true, filesScanned }
      }
    }
  }
  return { hits, truncated: false, filesScanned }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/workspace-search.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/main/workspace/service.ts tests/unit/workspace-search.test.ts
git commit -m "feat(workspace): confined case-insensitive content search"
```

---

### Task 2: `search_files` tool (main)

**Files:**
- Modify: `src/main/chat/tools.ts` (add spec, `READ_ONLY` entry, `executeTool` branch)
- Test: `tests/unit/tools-search.test.ts` (create)

**Interfaces:**
- Consumes: `Workspace.search` (Task 1); existing `ToolDeps` (has `workspace`), `executeTool(name, argsRaw, callId, deps)`.
- Produces: tool name `search_files` in `TOOL_SPECS` and `isKnownTool('search_files') === true`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tools-search.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { executeTool, isKnownTool, TOOL_SPECS } from '../../src/main/chat/tools.js'
import type { ToolDeps } from '../../src/main/chat/tools.js'
import type { SearchResult } from '../../src/main/workspace/service.js'

function deps(search: (q: string) => Promise<SearchResult>): ToolDeps {
  return {
    workspace: { search } as unknown as ToolDeps['workspace'],
    turnId: 't1',
    requestApproval: async () => ({ action: 'reject' }),
  }
}

describe('search_files tool', () => {
  it('is advertised and known', () => {
    expect(TOOL_SPECS.some((t) => t.name === 'search_files')).toBe(true)
    expect(isKnownTool('search_files')).toBe(true)
  })

  it('formats hits as relPath:line: text and auto-runs (no approval)', async () => {
    const out = await executeTool('search_files', JSON.stringify({ query: 'foo' }), 'c1', deps(
      async () => ({ hits: [{ relPath: 'src/a.ts', line: 3, text: 'const foo = 1' }], truncated: false, filesScanned: 1 }),
    ))
    expect(out.isError).toBe(false)
    expect(out.result).toContain('src/a.ts:3: const foo = 1')
  })

  it('notes truncation', async () => {
    const out = await executeTool('search_files', JSON.stringify({ query: 'foo' }), 'c1', deps(
      async () => ({ hits: [{ relPath: 'a', line: 1, text: 'foo' }], truncated: true, filesScanned: 9 }),
    ))
    expect(out.result.toLowerCase()).toContain('truncat')
  })

  it('reports no matches clearly', async () => {
    const out = await executeTool('search_files', JSON.stringify({ query: 'zzz' }), 'c1', deps(
      async () => ({ hits: [], truncated: false, filesScanned: 4 }),
    ))
    expect(out.isError).toBe(false)
    expect(out.result.toLowerCase()).toContain('no matches')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tools-search.test.ts`
Expected: FAIL — `search_files` not in specs / unknown tool.

- [ ] **Step 3: Implement in `src/main/chat/tools.ts`**

Add to `TOOL_SPECS` (after the `list_dir` entry):

```ts
  {
    name: 'search_files',
    description: 'Search file CONTENTS across the workspace (case-insensitive substring). Returns "relPath:line: text" lines. Use this to find where something lives before reading whole files.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Text to search for' } },
      required: ['query'],
    },
  },
```

Add `search_files` to the read-only set:

```ts
const READ_ONLY = new Set(['read_file', 'list_dir', 'search_files'])
```

Add a branch inside `executeTool`'s `try` block, next to `list_dir`:

```ts
    if (name === 'search_files') {
      const res = await workspace.search(String(args['query'] ?? ''))
      if (res.hits.length === 0) return { result: 'No matches found.', isError: false }
      const body = res.hits.map((h) => `${h.relPath}:${h.line}: ${h.text}`).join('\n')
      const note = res.truncated ? `\n[results truncated at ${res.hits.length} matches — narrow the query]` : ''
      return { result: body + note, isError: false }
    }
```

Note: `Workspace.search` is now referenced by `ToolDeps['workspace']`; the type already resolves because `ToolDeps.workspace: Workspace` and `search` is a public method after Task 1. No import change needed (`SearchResult` is only imported in the test).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/tools-search.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/tools.ts tests/unit/tools-search.test.ts
git commit -m "feat(agent): search_files read-only tool"
```

---

### Task 3: Trust-for-this-turn (engine + IPC plumbing)

**Files:**
- Modify: `src/shared/ipc.ts` (add `trustTurn` to `ToolDecisionSchema`)
- Modify: `src/preload/index.ts` (widen `toolDecision` signature + payload)
- Modify: `src/main/ipc/handlers.ts` (pass `trustTurn` to `resolveApproval`)
- Modify: `src/main/chat/stream-engine.ts` (trusted-turn set, short-circuit, cleanup)
- Test: `tests/unit/stream-engine-trust.test.ts` (create)

**Interfaces:**
- Consumes: existing `StreamEngine` deps `{ emit, readKey, store, resolveProvider, workspace? }`; `Workspace` (Task 1 unchanged), `ApprovalDecision` from `tools.js`.
- Produces:
  ```ts
  // StreamEngine:
  resolveApproval(callId: string, decision: ApprovalDecision, trustTurn?: boolean): void
  // preload window.modelith.chat:
  toolDecision(callId: string, action: 'accept' | 'reject' | 'edited', content?: string, trustTurn?: boolean): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/stream-engine-trust.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamEngine } from '../../src/main/chat/stream-engine.js'
import { SessionStore } from '../../src/main/sessions/store.js'
import { Workspace } from '../../src/main/workspace/service.js'
import type { Provider } from '../../src/main/providers/types.js'
import type { StreamEnvelope } from '../../src/shared/types.js'
import type { AppSettingsStore } from '../../src/main/settings/store.js'

function fakeSettings(root: string): AppSettingsStore {
  return { get: async () => ({ workspaceRoot: root }), set: async () => {} } as unknown as AppSettingsStore
}

// Emits TWO write_file calls in one turn, then finishes once results return.
function twoWriteProvider(): Provider {
  return {
    id: 'fake', label: 'Fake', defaultBaseUrl: 'http://localhost', requiresKey: false,
    listModels: async () => [],
    async *streamChat(req) {
      const last = req.messages[req.messages.length - 1]
      if (last?.role === 'tool') { yield { type: 'done' }; return }
      yield { type: 'tool_call', id: 'w1', name: 'write_file', arguments: JSON.stringify({ path: 'one.txt', content: 'one\n' }) }
      yield { type: 'tool_call', id: 'w2', name: 'write_file', arguments: JSON.stringify({ path: 'two.txt', content: 'two\n' }) }
      yield { type: 'done' }
    },
  }
}

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await pred()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

let store: SessionStore
let root: string
let emitted: StreamEnvelope[]

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oc-trust-'))
  store = new SessionStore(dir)
  root = await mkdtemp(join(tmpdir(), 'oc-trust-root-'))
  emitted = []
})

function build(): StreamEngine {
  return new StreamEngine({
    emit: (e) => { emitted.push(e) },
    readKey: async () => 'k',
    store,
    resolveProvider: () => twoWriteProvider(),
    workspace: new Workspace(fakeSettings(root), () => undefined),
  } as ConstructorParameters<typeof StreamEngine>[0])
}

describe('trust-for-this-turn', () => {
  it('applies the rest of the turn after one trusting accept, emitting only one gate', async () => {
    const s = await store.create('t')
    const engine = build()
    await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'go', agent: true })

    // First pending gate arrives.
    await waitFor(() => emitted.some((e) => e.event.type === 'tool_pending'))
    const firstPending = emitted.find((e) => e.event.type === 'tool_pending')!
    const callId = (firstPending.event as { callId: string }).callId

    // Accept WITH trust.
    engine.resolveApproval(callId, { action: 'accept' }, true)

    // The turn finishes; both files were written.
    await waitFor(() => emitted.some((e) => e.event.type === 'done'))
    expect((await readFile(join(root, 'one.txt'), 'utf8'))).toBe('one\n')
    expect((await readFile(join(root, 'two.txt'), 'utf8'))).toBe('two\n')

    // Exactly ONE gate was ever shown.
    expect(emitted.filter((e) => e.event.type === 'tool_pending').length).toBe(1)
  })

  it('does not carry trust into a second turn (gate returns)', async () => {
    const s = await store.create('t')
    const engine = build()
    await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'go', agent: true })
    await waitFor(() => emitted.some((e) => e.event.type === 'tool_pending'))
    engine.resolveApproval((emitted.find((e) => e.event.type === 'tool_pending')!.event as { callId: string }).callId, { action: 'accept' }, true)
    await waitFor(() => emitted.some((e) => e.event.type === 'done'))

    emitted = []
    await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'go again', agent: true })
    await waitFor(() => emitted.some((e) => e.event.type === 'tool_pending'))
    expect(emitted.some((e) => e.event.type === 'tool_pending')).toBe(true)
  })
})
```

Note on `agent: true`: confirm the exact field the engine reads to enable tools (search `start(` params in `stream-engine.ts` — it derives `agent`/`root`). If the flag is named differently (e.g. `agentMode`), use that name in the test's `start(...)` call.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/stream-engine-trust.test.ts`
Expected: FAIL — second `tool_pending` is emitted (trust not implemented), so the "exactly one gate" assertion fails.

- [ ] **Step 3: Add `trustTurn` to the schema**

`src/shared/ipc.ts` — extend `ToolDecisionSchema`:

```ts
export const ToolDecisionSchema = z.object({
  callId: z.string().min(1),
  action: z.enum(['accept', 'reject', 'edited']),
  content: z.string().optional(),
  trustTurn: z.boolean().optional(),
})
```

- [ ] **Step 4: Widen the preload bridge**

`src/preload/index.ts`:
- Type (around line 31):
  ```ts
  toolDecision(callId: string, action: 'accept' | 'reject' | 'edited', content?: string, trustTurn?: boolean): Promise<void>
  ```
- Implementation (around line 110):
  ```ts
  toolDecision: (callId, action, content, trustTurn) => ipcRenderer.invoke(CHANNELS.chatToolDecision, { callId, action, content, trustTurn }),
  ```

- [ ] **Step 5: Pass `trustTurn` through the handler**

`src/main/ipc/handlers.ts` (the `chatToolDecision` handler, ~line 201):

```ts
  ipcMain.handle(CHANNELS.chatToolDecision, withZodMapping((_e, raw: unknown) => {
    const { callId, action, content, trustTurn } = ToolDecisionSchema.parse(raw)
    engine.resolveApproval(callId, action === 'edited' ? { action, content: content ?? '' } : { action }, trustTurn)
  }))
```

- [ ] **Step 6: Implement trust in the engine**

`src/main/chat/stream-engine.ts`:

Add fields near `pendingApprovals` (~line 71):
```ts
  /** Turns the user has elected to auto-apply for (keyed by turnId === streamId). */
  private readonly trustedTurns = new Set<string>()
  /** callId → turnId, so a trusting decision can mark the right turn. */
  private readonly pendingTurns = new Map<string, string>()
```

Widen `resolveApproval` (~line 92):
```ts
  resolveApproval(callId: string, decision: ApprovalDecision, trustTurn = false): void {
    if (trustTurn && decision.action === 'accept') {
      const turnId = this.pendingTurns.get(callId)
      if (turnId) this.trustedTurns.add(turnId)
    }
    const resolve = this.pendingApprovals.get(callId)
    if (resolve) { this.pendingApprovals.delete(callId); resolve(decision) }
  }
```

Thread `turnId` into the two gate methods. At the call sites (~lines 370–371) change to:
```ts
          requestApproval: (edit) => this.requestApproval(streamId, sessionId, edit, controller, turnId),
          requestConfirm: (confirm) => this.requestConfirm(streamId, sessionId, confirm, controller, turnId),
```

`requestApproval` (~line 400) — add `turnId` param, short-circuit, and track/clean `pendingTurns`:
```ts
  private requestApproval(
    streamId: string,
    sessionId: string,
    edit: PendingEdit,
    controller: AbortController,
    turnId: string,
  ): Promise<ApprovalDecision> {
    if (this.trustedTurns.has(turnId)) return Promise.resolve({ action: 'accept' })
    return new Promise<ApprovalDecision>((resolve) => {
      if (controller.signal.aborted) { resolve({ action: 'reject' }); return }
      const settle = (decision: ApprovalDecision) => {
        this.pendingTurns.delete(edit.callId)
        controller.signal.removeEventListener('abort', onAbort)
        resolve(decision)
      }
      const onAbort = () => { this.pendingApprovals.delete(edit.callId); settle({ action: 'reject' }) }
      controller.signal.addEventListener('abort', onAbort, { once: true })
      this.pendingApprovals.set(edit.callId, settle)
      this.pendingTurns.set(edit.callId, turnId)
      this.send(streamId, sessionId, {
        type: 'tool_pending', callId: edit.callId, tool: edit.tool, relPath: edit.relPath, previous: edit.previous, proposed: edit.proposed,
      })
    })
  }
```

`requestConfirm` (~line 422) — same treatment (`turnId` param, short-circuit returns `'accept'`, track/clean `pendingTurns`):
```ts
  private requestConfirm(
    streamId: string,
    sessionId: string,
    confirm: { callId: string; name: string; argsJson: string },
    controller: AbortController,
    turnId: string,
  ): Promise<'accept' | 'reject'> {
    if (this.trustedTurns.has(turnId)) return Promise.resolve('accept')
    return new Promise<'accept' | 'reject'>((resolve) => {
      if (controller.signal.aborted) { resolve('reject'); return }
      const settle = (decision: ApprovalDecision) => {
        this.pendingTurns.delete(confirm.callId)
        controller.signal.removeEventListener('abort', onAbort)
        resolve(decision.action === 'reject' ? 'reject' : 'accept')
      }
      const onAbort = () => { this.pendingApprovals.delete(confirm.callId); settle({ action: 'reject' }) }
      controller.signal.addEventListener('abort', onAbort, { once: true })
      this.pendingApprovals.set(confirm.callId, settle)
      this.pendingTurns.set(confirm.callId, turnId)
      this.send(streamId, sessionId, { type: 'tool_confirm', callId: confirm.callId, name: confirm.name, argsJson: confirm.argsJson })
    })
  }
```

Cleanup so trust never leaks. In the `.finally()` of `run()` (the block that does `this.activeSessions.delete(sessionId); this.active.delete(streamId)`, ~line 130) add:
```ts
        this.trustedTurns.delete(streamId)
```
And in `abort(streamId)` (~line 83) add after `this.active.delete(streamId)`:
```ts
    this.trustedTurns.delete(streamId)
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/unit/stream-engine-trust.test.ts`
Expected: PASS (both). Then run the existing engine suite to prove no regression:
Run: `npx vitest run tests/unit/stream-engine.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/ipc/handlers.ts src/main/chat/stream-engine.ts tests/unit/stream-engine-trust.test.ts
git commit -m "feat(agent): trust-for-this-turn (one accept applies the rest of the turn)"
```

---

### Task 4: Renderer approval UI — trust button + banner

**Files:**
- Modify: `src/renderer/state/store.ts` (`resolveEdit`/`resolveConfirm` gain `trustTurn`; add `trustedTurn` flag + reset points)
- Modify: `src/renderer/chat/DiffGate.tsx` (add trust buttons)
- Modify: `src/renderer/app/theme.css` (banner style)
- Test: `tests/unit/renderer-store.test.ts` (extend)

**Interfaces:**
- Consumes: `window.modelith.chat.toolDecision(callId, action, content?, trustTurn?)` (Task 3).
- Produces on the store: `resolveEdit(action, content?, trustTurn?)`, `resolveConfirm(action, allowSession?, trustTurn?)`, boolean state `trustedTurn`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/renderer-store.test.ts`, add a test (mirror the file's existing setup for mocking `window.modelith`). If the file already has a `window.modelith.chat.toolDecision` mock capturing calls, assert on it; otherwise add a capturing mock:

```ts
it('resolveEdit forwards trustTurn and sets the trusted banner', () => {
  const calls: unknown[] = []
  ;(globalThis as unknown as { window: { modelith: { chat: { toolDecision: (...a: unknown[]) => void } } } }).window = {
    modelith: { chat: { toolDecision: (...a: unknown[]) => { calls.push(a) } } },
  } as never
  const store = makeStore() // use the file's existing store factory / import
  store.setState({ pendingEdit: { callId: 'c1', tool: 'write_file', relPath: 'a', previous: null, proposed: 'x' } })
  store.getState().resolveEdit('accept', undefined, true)
  expect(calls[0]).toEqual(['c1', 'accept', undefined, true])
  expect(store.getState().trustedTurn).toBe(true)
})
```

Match the actual store-access pattern used elsewhere in this test file (it may import `useAppStore` and call `useAppStore.getState()` / `useAppStore.setState()` rather than a `makeStore()` helper). Use whatever that file already uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer-store.test.ts`
Expected: FAIL — `resolveEdit` ignores the 3rd arg / `trustedTurn` undefined.

- [ ] **Step 3: Update the store**

`src/renderer/state/store.ts`:
- Add state field near `pendingEdit` (in both the interface ~line 116 area and the initial state ~line 257):
  ```ts
  trustedTurn: boolean            // interface
  trustedTurn: false,             // initial state
  ```
- Update `resolveEdit`:
  ```ts
  resolveEdit(action, content, trustTurn) {
    const edit = get().pendingEdit
    if (!edit) return
    set({ pendingEdit: null, ...(trustTurn && action === 'accept' ? { trustedTurn: true } : {}) })
    void window.modelith.chat.toolDecision(edit.callId, action, content, trustTurn)
  },
  ```
- Update `resolveConfirm` to accept a 3rd `trustTurn` arg the same way:
  ```ts
  resolveConfirm(action, allowSession, trustTurn) {
    const confirm = get().pendingConfirm
    if (!confirm) return
    set((s) => ({
      pendingConfirm: null,
      ...(trustTurn && action === 'accept' ? { trustedTurn: true } : {}),
      allowedTools: allowSession && action === 'accept' ? [...new Set([...s.allowedTools, confirm.name])] : s.allowedTools,
    }))
    void window.modelith.chat.toolDecision(confirm.callId, action, undefined, trustTurn)
  },
  ```
- Update the method **signatures** in the store's TypeScript interface accordingly:
  ```ts
  resolveEdit(action: 'accept' | 'reject' | 'edited', content?: string, trustTurn?: boolean): void
  resolveConfirm(action: 'accept' | 'reject', allowSession?: boolean, trustTurn?: boolean): void
  ```
- Reset `trustedTurn` to `false` at the start of a new send and on stream end. Find the `send`/`start` action and add `trustedTurn: false` to its initial `set(...)`. Find where a `done`/`error` stream event is handled (search `event.type === 'done'` and `event.type === 'error'`) and set `trustedTurn: false` there. Also reset in `selectSession` (mirrors how `lastEditTurnId`/`canvasSelection` are cleared).

- [ ] **Step 4: Add the trust buttons + banner to `DiffGate.tsx`**

In the confirm branch actions (after the `Run`/`Reject` buttons, ~line 52) add:
```tsx
            <button className="ghost-button" data-testid="confirm-trust-turn" onClick={() => resolveConfirm('accept', false, true)}>
              Run &amp; trust this turn
            </button>
```

In the diff (write) branch actions, the non-editing group (~line 110), add after Accept:
```tsx
              <button className="action-primary" data-testid="diff-accept-trust" onClick={() => resolveEdit('accept', undefined, true)}>
                Accept &amp; auto-apply rest of turn
              </button>
```

At the top of the returned modal for the write branch (inside `.diff-gate`, before `.diff-gate-head`), and likewise the confirm branch, add a banner shown when trusting is active:
```tsx
        {useAppStore.getState().trustedTurn ? (
          <div className="trust-banner" data-testid="trust-banner">Auto-applying edits this turn</div>
        ) : null}
```
Prefer a selector subscription over `getState()` for reactivity: add near the other selectors `const trustedTurn = useAppStore((s) => s.trustedTurn)` and render `{trustedTurn ? <div className="trust-banner" data-testid="trust-banner">Auto-applying edits this turn</div> : null}`.

- [ ] **Step 5: Style the banner in `theme.css`**

Append:
```css
.trust-banner {
  margin-bottom: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--accent-soft, rgba(120, 120, 255, 0.15));
  color: var(--text-muted, #8a8a99);
}
```
(Reuse existing color variables already defined in `theme.css`; if `--accent-soft`/`--text-muted` do not exist, use ones that do — grep `theme.css` for the palette.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/renderer-store.test.ts`
Expected: PASS. Then typecheck: `npm run typecheck` (or `npx tsc -p tsconfig.json --noEmit`) — Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/state/store.ts src/renderer/chat/DiffGate.tsx src/renderer/app/theme.css tests/unit/renderer-store.test.ts
git commit -m "feat(agent): trust-this-turn buttons + auto-apply banner"
```

---

### Task 5: Persistent Project tree (renderer)

**Files:**
- Create: `src/renderer/chat/WorkspaceTree.tsx` (flat `TreeEntry[]` → collapsible tree)
- Modify: `src/renderer/chat/WorkspacePanel.tsx` (use the tree; prominent open; project header)
- Modify: `src/renderer/state/store.ts` (`initWorkspace` opens the panel when a root is restored)
- Modify: `src/renderer/app/theme.css` (tree styles)
- Test: `tests/unit/workspace-tree.test.ts` (create — the pure grouping function)

**Interfaces:**
- Consumes: `WorkspaceTreeEntry` from `@shared/types` (`{ relPath, name, kind: 'file'|'dir', size?, readable }`); store `workspaceTree`, `workspaceRoot`, `pickWorkspace`, `draft`/`setDraft`, `window.modelith.workspace.read`.
- Produces: `buildTree(entries: WorkspaceTreeEntry[]): TreeNode[]` and `<WorkspaceTree>` component; `initWorkspace` sets `workspaceOpen: true` when a root exists.

- [ ] **Step 1: Write the failing test for the pure builder**

Create `tests/unit/workspace-tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildTree } from '../../src/renderer/chat/WorkspaceTree.js'
import type { WorkspaceTreeEntry } from '../../src/shared/types.js'

const e = (relPath: string, kind: 'file' | 'dir'): WorkspaceTreeEntry => ({
  relPath, name: relPath.split('/').pop()!, kind, readable: kind === 'file',
})

describe('buildTree', () => {
  it('nests files under their directories', () => {
    const nodes = buildTree([e('src', 'dir'), e('src/a.ts', 'file'), e('README.md', 'file')])
    const src = nodes.find((n) => n.name === 'src')!
    expect(src.kind).toBe('dir')
    expect(src.children.map((c) => c.name)).toEqual(['a.ts'])
    expect(nodes.some((n) => n.name === 'README.md' && n.kind === 'file')).toBe(true)
  })

  it('orders directories before files at each level', () => {
    const nodes = buildTree([e('z.txt', 'file'), e('lib', 'dir'), e('lib/x.ts', 'file')])
    expect(nodes[0]!.kind).toBe('dir')
    expect(nodes[0]!.name).toBe('lib')
    expect(nodes[1]!.name).toBe('z.txt')
  })

  it('synthesizes intermediate directories missing from the flat list', () => {
    const nodes = buildTree([e('a/b/c.ts', 'file')])
    const a = nodes.find((n) => n.name === 'a')!
    const b = a.children.find((n) => n.name === 'b')!
    expect(b.children[0]!.name).toBe('c.ts')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/workspace-tree.test.ts`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement `WorkspaceTree.tsx`**

Create `src/renderer/chat/WorkspaceTree.tsx`:

```tsx
import { useState } from 'react'
import type { WorkspaceTreeEntry } from '@shared/types'
import { IconFolder } from '../app/icons.js'

export interface TreeNode {
  name: string
  relPath: string
  kind: 'file' | 'dir'
  readable: boolean
  size?: number
  children: TreeNode[]
}

/** Group a flat, already-confined entry list into a nested, ordered tree. */
export function buildTree(entries: WorkspaceTreeEntry[]): TreeNode[] {
  const rootChildren: TreeNode[] = []
  const byPath = new Map<string, TreeNode>()

  const ensureDir = (relPath: string): TreeNode => {
    const existing = byPath.get(relPath)
    if (existing) return existing
    const name = relPath.split('/').pop()!
    const node: TreeNode = { name, relPath, kind: 'dir', readable: false, children: [] }
    byPath.set(relPath, node)
    const parent = relPath.includes('/') ? ensureDir(relPath.slice(0, relPath.lastIndexOf('/'))) : null
    ;(parent ? parent.children : rootChildren).push(node)
    return node
  }

  for (const entry of entries) {
    if (entry.kind === 'dir') { ensureDir(entry.relPath); continue }
    const name = entry.name
    const node: TreeNode = {
      name, relPath: entry.relPath, kind: 'file', readable: entry.readable,
      ...(entry.size !== undefined ? { size: entry.size } : {}), children: [],
    }
    byPath.set(entry.relPath, node)
    const parentPath = entry.relPath.includes('/') ? entry.relPath.slice(0, entry.relPath.lastIndexOf('/')) : ''
    ;(parentPath ? ensureDir(parentPath).children : rootChildren).push(node)
  }

  const sort = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
    for (const n of nodes) if (n.children.length) sort(n.children)
    return nodes
  }
  return sort(rootChildren)
}

interface RowProps { node: TreeNode; depth: number; onAddFile: (relPath: string) => void }

function Row({ node, depth, onAddFile }: RowProps): React.JSX.Element {
  const [open, setOpen] = useState(depth < 1) // top level expanded by default
  const pad = { paddingLeft: `${8 + depth * 12}px` }
  if (node.kind === 'dir') {
    return (
      <div>
        <div className="tree-row tree-dir" style={pad} data-testid="tree-dir" onClick={() => setOpen((v) => !v)}>
          <span className="tree-caret">{open ? '▾' : '▸'}</span>
          <IconFolder size={12} /> <span className="tree-name">{node.name}</span>
        </div>
        {open ? node.children.map((c) => <Row key={c.relPath} node={c} depth={depth + 1} onAddFile={onAddFile} />) : null}
      </div>
    )
  }
  return (
    <div className={`tree-row tree-file${node.readable ? '' : ' tree-file-disabled'}`} style={pad} data-testid="tree-file">
      <span className="tree-name" title={node.relPath}>{node.name}</span>
      {node.readable ? (
        <button className="tree-add" data-testid="tree-add" title="Add to message" onClick={() => onAddFile(node.relPath)}>＋</button>
      ) : null}
    </div>
  )
}

export function WorkspaceTree({ entries, onAddFile }: { entries: WorkspaceTreeEntry[]; onAddFile: (relPath: string) => void }): React.JSX.Element {
  const nodes = buildTree(entries)
  if (nodes.length === 0) return <p className="inspector-empty">No files.</p>
  return <div className="tree" data-testid="workspace-tree">{nodes.map((n) => <Row key={n.relPath} node={n} depth={0} onAddFile={onAddFile} />)}</div>
}
```

- [ ] **Step 4: Run the builder test**

Run: `npx vitest run tests/unit/workspace-tree.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Rework `WorkspacePanel.tsx` to use the tree**

Replace the flat checkbox list + add-selected flow with the tree. Keep the same `data-testid="workspace-panel"`, `data-testid="workspace-open"` (empty-state button), and `data-testid="workspace-change"`. The per-file add now goes through `onAddFile`:

```tsx
import { useAppStore } from '../state/store.js'
import { fencedAttachment } from './fence-lang.js'
import { IconFolder } from '../app/icons.js'
import { WorkspaceTree } from './WorkspaceTree.js'

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export function WorkspacePanel(): React.JSX.Element | null {
  const open = useAppStore((s) => s.workspaceOpen)
  const toggle = useAppStore((s) => s.toggleWorkspace)
  const root = useAppStore((s) => s.workspaceRoot)
  const tree = useAppStore((s) => s.workspaceTree)
  const pick = useAppStore((s) => s.pickWorkspace)
  const draft = useAppStore((s) => s.draft)
  const setDraft = useAppStore((s) => s.setDraft)
  const reportError = useAppStore((s) => s.reportError)

  if (!open) return null

  const addFile = async (relPath: string) => {
    try {
      const { text } = await window.modelith.workspace.read(relPath)
      const block = fencedAttachment(baseName(relPath), text)
      const prefix = draft.trim() ? `${draft.trimEnd()}\n\n` : ''
      setDraft(`${prefix}${block}\n\n`)
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(`${relPath} could not be read.`))
    }
  }

  return (
    <aside className="workspace" data-testid="workspace-panel" aria-label="Workspace">
      <div className="inspector-head">
        <span className="inspector-title">Project</span>
        <button className="icon-button" aria-label="Close project" onClick={toggle}>✕</button>
      </div>

      {!root ? (
        <div className="workspace-empty">
          <p>No folder open.</p>
          <button className="action-primary" data-testid="workspace-open" onClick={() => void pick()}>
            <IconFolder size={13} /> Open Folder…
          </button>
        </div>
      ) : (
        <>
          <div className="workspace-root">
            <IconFolder size={13} />
            <span className="workspace-root-name" title={root}>{baseName(root)}</span>
            <button className="ghost-button" data-testid="workspace-change" onClick={() => void pick()}>Change</button>
          </div>
          <div className="workspace-list">
            <WorkspaceTree entries={tree} onAddFile={(p) => void addFile(p)} />
          </div>
        </>
      )}
    </aside>
  )
}
```

- [ ] **Step 6: Auto-open the panel when a folder is restored**

`src/renderer/state/store.ts` — in `initWorkspace`, when a root is found, also open the panel:
```ts
      set({ workspaceRoot: root, workspaceTree: tree, workspaceOpen: true })
```

- [ ] **Step 7: Add tree styles to `theme.css`**

```css
.tree { font-size: 13px; }
.tree-row { display: flex; align-items: center; gap: 4px; padding: 2px 8px; cursor: default; white-space: nowrap; }
.tree-dir { cursor: pointer; }
.tree-caret { width: 10px; display: inline-block; color: var(--text-muted, #8a8a99); }
.tree-file .tree-name { overflow: hidden; text-overflow: ellipsis; }
.tree-file-disabled { opacity: 0.45; }
.tree-add { margin-left: auto; background: none; border: none; color: var(--text-muted, #8a8a99); cursor: pointer; font-size: 13px; }
.tree-add:hover { color: var(--text, #e6e6ef); }
```
(Grep `theme.css` first and reuse its real variable names.)

- [ ] **Step 8: Typecheck + unit run**

Run: `npm run typecheck` — Expected: clean.
Run: `npx vitest run tests/unit/workspace-tree.test.ts` — Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/chat/WorkspaceTree.tsx src/renderer/chat/WorkspacePanel.tsx src/renderer/state/store.ts src/renderer/app/theme.css tests/unit/workspace-tree.test.ts
git commit -m "feat(workspace): persistent collapsible project tree + prominent open + restore"
```

---

### Task 6: System-prompt hint when a project is open (main)

**Files:**
- Modify: `src/main/chat/stream-engine.ts` (append a discovery hint to the system prompt in agent mode)
- Test: `tests/unit/stream-engine-hint.test.ts` (create)

**Interfaces:**
- Consumes: the engine's per-iteration system-prompt assembly (~lines 312–314) where `withSystem` is built.
- Produces: when `agent && root`, the system message content ends with a one-line hint naming `list_dir`, `search_files`, `read_file`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/stream-engine-hint.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamEngine } from '../../src/main/chat/stream-engine.js'
import { SessionStore } from '../../src/main/sessions/store.js'
import { Workspace } from '../../src/main/workspace/service.js'
import type { Provider } from '../../src/main/providers/types.js'
import type { AppSettingsStore } from '../../src/main/settings/store.js'

function fakeSettings(root: string): AppSettingsStore {
  return { get: async () => ({ workspaceRoot: root }), set: async () => {} } as unknown as AppSettingsStore
}

let store: SessionStore
let root: string

beforeEach(async () => {
  store = new SessionStore(await mkdtemp(join(tmpdir(), 'oc-hint-')))
  root = await mkdtemp(join(tmpdir(), 'oc-hint-root-'))
})

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!pred()) { if (Date.now() - start > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)) }
}

it('appends a discovery hint to the system prompt in agent mode', async () => {
  let seenSystem = ''
  const provider: Provider = {
    id: 'fake', label: 'Fake', defaultBaseUrl: 'http://localhost', requiresKey: false,
    listModels: async () => [],
    async *streamChat(req) {
      seenSystem = req.messages.find((m) => m.role === 'system')?.content ?? ''
      yield { type: 'done' }
    },
  }
  const engine = new StreamEngine({
    emit: () => {}, readKey: async () => 'k', store, resolveProvider: () => provider,
    workspace: new Workspace(fakeSettings(root), () => undefined),
  } as ConstructorParameters<typeof StreamEngine>[0])
  const s = await store.create('t')
  await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'hi', systemPrompt: 'Base.', agent: true })
  await waitFor(() => seenSystem !== '')
  expect(seenSystem).toContain('Base.')
  expect(seenSystem).toContain('search_files')
})
```

Confirm the agent-enabling flag name in `start(...)` (see Task 3 note) and use it here too.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/stream-engine-hint.test.ts`
Expected: FAIL — system prompt lacks `search_files`.

- [ ] **Step 3: Implement the hint**

`src/main/chat/stream-engine.ts` — add a constant near the top of the file:
```ts
const PROJECT_HINT =
  'A project folder is open. Use list_dir, search_files, and read_file to explore it yourself before proposing edits; do not ask the user to paste files.'
```

Where the system message is assembled (~line 312), fold the hint into the system content when tools are on and a root exists. Replace the `withSystem` construction with:
```ts
      const systemText = [input.systemPrompt, agent && root ? PROJECT_HINT : '']
        .filter(Boolean).join('\n\n')
      const withSystem: ChatMessage[] = systemText
        ? [{ id: randomUUID(), role: 'system', content: systemText, createdAt: Date.now() }, ...history]
        : history
```
(Use the same variable names already in scope — `agent`, `root`, `history`, `input.systemPrompt`. If `agent`/`root` are named differently at that point in the function, match them.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/stream-engine-hint.test.ts tests/unit/stream-engine.test.ts`
Expected: PASS (hint test + no regression).

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/stream-engine.ts tests/unit/stream-engine-hint.test.ts
git commit -m "feat(agent): system-prompt hint to self-explore an open project"
```

---

### Task 7: Fake-provider triggers + E2E

**Files:**
- Modify: `src/main/providers/registry.ts` (add `agent multiwrite` and `agent search` triggers)
- Create: `tests/e2e/project-mode.spec.ts`

**Interfaces:**
- Consumes: the e2e `launchApp` helper (`tests/e2e/launch.js`), the fake provider (`MODELITH_FAKE_PROVIDER=1`), and the agent-enable flow from `tests/e2e/agentic-edits.spec.ts` (`startAgentTurn` pattern).
- Produces: two new deterministic fake triggers and three e2e specs (tree renders, trust-for-turn multi-file, search smoke).

- [ ] **Step 1: Add fake-provider triggers**

`src/main/providers/registry.ts`, inside the `if (req.tools && req.tools.length > 0)` block (before the existing `/agent write/` branch is fine), add:

```ts
      if (/agent multiwrite/i.test(lastUser)) {
        yield { type: 'tool_call' as const, id: `${callId}-a`, name: 'write_file', arguments: JSON.stringify({ path: 'one.txt', content: 'one\n' }) }
        yield { type: 'tool_call' as const, id: `${callId}-b`, name: 'write_file', arguments: JSON.stringify({ path: 'two.txt', content: 'two\n' }) }
        yield { type: 'done' as const }
        return
      }
      if (/agent search/i.test(lastUser)) {
        yield { type: 'tool_call' as const, id: callId, name: 'search_files', arguments: JSON.stringify({ query: 'seed' }) }
        yield { type: 'done' as const }
        return
      }
```

(The `lastMsg?.role === 'tool'` branch above already ends the turn once results return, so both triggers terminate cleanly.)

- [ ] **Step 2: Write the E2E specs**

Create `tests/e2e/project-mode.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { launchApp } from './launch.js'

let app: ElectronApplication
let root: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'oc-pm-'))
  writeFileSync(join(root, 'seed.txt'), 'the seed marker lives here')
  app = await launchApp({ MODELITH_FAKE_PROVIDER: '1', MODELITH_WORKSPACE_ROOT: root })
})
test.afterEach(async () => { await app.close() })

async function openProject(page: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  await page.getByTestId('new-session').click()
  await page.getByTestId('open-workspace').click()
  const openBtn = page.getByTestId('workspace-open')
  if (await openBtn.isVisible().catch(() => false)) await openBtn.click()
}

async function enableAgent(page: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  await expect(page.getByTestId('toggle-agent')).toBeEnabled({ timeout: 8000 })
  await page.getByTestId('toggle-agent').click()
  await page.getByTestId('open-workspace').click() // close the drawer so the composer is clear
}

test('the project tree renders the folder contents', async () => {
  const page = await app.firstWindow()
  await openProject(page)
  await expect(page.getByTestId('workspace-tree')).toBeVisible({ timeout: 8000 })
  await expect(page.getByTestId('workspace-tree')).toContainText('seed.txt')
})

test('trust-this-turn applies multiple files from one approval', async () => {
  const page = await app.firstWindow()
  await openProject(page)
  await enableAgent(page)
  await page.getByTestId('composer-input').fill('agent multiwrite please')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('diff-gate')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('diff-accept-trust').click()
  // Both files land without a second gate.
  await expect.poll(() => existsSync(join(root, 'one.txt')), { timeout: 8000 }).toBe(true)
  await expect.poll(() => existsSync(join(root, 'two.txt')), { timeout: 8000 }).toBe(true)
  expect(readFileSync(join(root, 'two.txt'), 'utf8')).toBe('two\n')
  // One revert undoes the whole turn.
  await expect(page.getByTestId('revert-bar')).toBeVisible({ timeout: 8000 })
  await page.getByTestId('revert-edits').click()
  await expect.poll(() => existsSync(join(root, 'one.txt')), { timeout: 8000 }).toBe(false)
  await expect.poll(() => existsSync(join(root, 'two.txt')), { timeout: 8000 }).toBe(false)
})

test('search_files runs without a gate and the turn completes', async () => {
  const page = await app.firstWindow()
  await openProject(page)
  await enableAgent(page)
  await page.getByTestId('composer-input').fill('agent search the code')
  await page.getByTestId('composer-send').click()
  // No approval gate for a read-only search; the turn finishes cleanly.
  await expect(page.getByTestId('diff-gate')).toHaveCount(0)
  await expect(page.getByTestId('tool-confirm')).toHaveCount(0)
  await expect(page.getByTestId('transcript')).toContainText('seed.txt', { timeout: 10_000 })
})
```

Note: the final assertion (`transcript` contains `seed.txt`) assumes tool-result content renders in the transcript. Before relying on it, confirm role:`tool` messages render (grep `MessageView.tsx` for a `tool` branch). If they do not render, change that assertion to wait for turn completion another way — e.g. assert the composer send button returns to its idle state, or that no error toast appears — since the rigorous search correctness is already covered by the Task 1 unit tests.

- [ ] **Step 3: Run the E2E**

Run: `npx playwright test tests/e2e/project-mode.spec.ts`
Expected: PASS (3). If the transcript assertion is flaky per the note above, switch it to a completion check.

- [ ] **Step 4: Commit**

```bash
git add src/main/providers/registry.ts tests/e2e/project-mode.spec.ts
git commit -m "test(e2e): project tree, trust-for-turn multi-file, search smoke"
```

---

### Task 8: Full suite + docs

**Files:**
- Modify: `CHANGELOG.md` (add an Unreleased / next-version entry)
- Modify: `README.md` (Project Mode blurb, if a feature list exists)

- [ ] **Step 1: Run the whole suite**

Run: `npm run test:unit` — Expected: all green (existing + `workspace-search`, `tools-search`, `stream-engine-trust`, `renderer-store`, `workspace-tree`, `stream-engine-hint`).
Run: `npx playwright test` — Expected: all green (existing + `project-mode`).

- [ ] **Step 2: Update CHANGELOG**

Add under a new `## Unreleased` heading:
```markdown
## Unreleased

### Project Mode
- `search_files` tool: the agent can search file contents across the project.
- Trust-for-this-turn: one approval can auto-apply the rest of a turn's edits
  (still checkpointed — one revert undoes the whole turn).
- Persistent collapsible project tree with a prominent "Open Folder" entry point,
  a project header, and auto-restore of the last folder on launch.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs: changelog + readme for Project Mode"
```

---

## Self-Review

**Spec coverage:**
- Unit 1 (search) → Tasks 1, 2. ✓
- Unit 2 (trust-for-turn, covers writes + confirms, per-turn, checkpointed, no leak) → Task 3 (engine) + Task 4 (UI). ✓
- Unit 3 (IPC/preload `trustTurn`) → Task 3. ✓
- Unit 4 (approval UI + banner) → Task 4. ✓
- Unit 5 (persistent tree, prominent open, header, restore, add-to-context kept, no viewer) → Task 5. ✓
- Unit 6 (system-prompt hint) → Task 6. ✓
- Testing (unit search/trust/tree/hint; e2e tree/trust/search) → Tasks 1–7. ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code. The two "confirm the flag name / confirm tool-results render" notes are verification instructions with explicit fallbacks, not deferred work.

**Type consistency:** `SearchHit`/`SearchResult` defined in Task 1, consumed with the same shape in Tasks 2/7. `resolveApproval(callId, decision, trustTurn?)` defined in Task 3, called in Task 3 handler. `toolDecision(..., trustTurn?)` widened in Task 3, used in Task 4. `TreeNode`/`buildTree` defined and consumed within Task 5. `trustedTurn` store field defined in Task 4, reset points enumerated.

**Known verification points to resolve during execution (flagged inline, with fallbacks):**
1. ~~Exact name of the agent-enable flag on `engine.start(...)` input~~ — RESOLVED: it is `input.agent === true`, and the in-scope variables are `agent` and `root` (`stream-engine.ts:286-288`). Test code and Task 6 use these verbatim.
2. Whether role:`tool` messages render in the transcript — Task 7 final assertion (has a fallback).
3. Real CSS variable names in `theme.css` — Tasks 4 & 5.
