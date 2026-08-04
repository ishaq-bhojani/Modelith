# AGENTS.md — orientation for AI coding agents

This file is the entry point for any AI agent (Claude Code, Cursor, Aider, etc.)
working in **Modelith**. Read it before touching code. It is tool-agnostic;
Claude Code also reads [`CLAUDE.md`](CLAUDE.md), which points here and adds a few
Claude-specific rules.

Modelith is a **free, open-source, provider-agnostic AI-agent desktop app** built
on Electron + React + TypeScript. Users bring their own API key (Anthropic, any
OpenAI-compatible endpoint, or a local Ollama model), watch artifacts render live,
and let an opt-in agent read/edit/run — every privileged action behind an
approval gate.

---

## Golden rules (do not break these)

1. **No API key, ever, reaches the renderer.** All provider traffic and secret
   handling live in the main process. The preload bridge exposes `keys.set` /
   `keys.delete` / `keys.has` — *no read path by design*. Enforced by
   `tests/e2e/preload-bridge.spec.ts`, `tests/e2e/security.spec.ts`, and the
   provider contract suite. If a change would let the renderer see, log, or
   forward a key, it does not land.
2. **`streamChat` never throws.** Providers yield exactly one terminal
   `{ type: 'done' }` (always last); every failure is a `{ type: 'error' }`
   event, never a throw. No error message may contain the API key. See
   [`CONTRIBUTING.md`](CONTRIBUTING.md).
3. **Workspace access stays confined.** Every read/write resolves against the
   dialog-chosen root via `realpath` + `isInsideRoot`; symlinks and `..` escapes
   are refused. The renderer never supplies the root string — main holds it.
4. **Privileged agent actions are gated.** File writes go through the diff
   approval gate and are checkpointed (revertable). Shell/MCP/commit calls are
   confirmed. `git` runs as an **argument vector, never through a shell**
   (`runFile`, not `runCommand`) so a hostile filename can't inject a command.
5. **The artifact canvas has no network egress.** It renders in a sandboxed
   iframe (no `allow-same-origin`) with a hash-pinned inline script; `fetch`
   inside it fails by design (`tests/e2e/canvas.spec.ts`).
6. **TDD.** Write the failing test first, watch it fail, implement, watch it
   pass, commit. Pure logic is unit-tested; provider wire formats go through the
   shared contract suite; user-facing flows get a Playwright e2e.

---

## Commands

| Command | What it does |
|---|---|
| `npm ci` | Install deps. A root `.npmrc` sets `legacy-peer-deps=true` (electron-vite peer-range lag — see CONTRIBUTING). |
| `npm run dev` | Launch the app in development (electron-vite). |
| `npm run build` | Compile main/preload/renderer into `out/`. |
| `npm run typecheck` | `tsc --noEmit` against both app and Node tsconfigs. Must be clean. |
| `npm test` | Vitest unit + contract suite. Fast; run this constantly. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run test:e2e` | **Builds first**, then the Playwright/Electron e2e suite. |
| `npm run dist` | Build + package installers with electron-builder (`--publish never`). |

**Requirements:** Node **>= 22.19.0**.

---

## Architecture — the three-process trust boundary

```
src/
  main/       Node process — secrets, network, filesystem, child processes.
  preload/    The ONLY bridge. contextBridge exposes a typed `window.modelith`.
  renderer/   Sandboxed React UI. No Node, no direct fs/net — everything via the bridge.
  shared/     Types + zod IPC schemas + pure helpers shared across processes.
```

### `src/main/` — privileged process
- `chat/` — `stream-engine.ts` (the streaming + agentic tool loop, failover,
  context budget, approval gating, **trust-for-this-turn**) and `tools.ts`
  (tool specs + `executeTool`: `read_file`, `list_dir`, `search_files`,
  `write_file`, `apply_edit`, `run_command`, git tools, MCP routing).
- `providers/` — provider abstraction. `types.ts` (the `Provider` interface +
  normalized `StreamEvent`), `stream-consumer.ts` (`consumeStream` — the one read
  loop), `anthropic.ts`, `ollama.ts`, `openai-compat.ts`, `registry.ts`
  (registered providers **and** the fake-provider triggers used by e2e).
- `workspace/` — `service.ts` (confined reads, `search`, `tree`, gated writes,
  checkpoints/revert), `paths.ts` (`isInsideRoot`, `isIgnored`),
  `edit-apply.ts`, `checkpoints.ts`.
- `mcp/` — stdio JSON-RPC 2.0 client + server manager; tools namespaced
  `mcp__<server>__<tool>`.
- `terminal/` — `runner.ts` (`runCommand` = shell, gated; `runFile` = arg-vector,
  no shell, for git), `git.ts`.
- `secrets/` — OS keychain via Electron `safeStorage`. `security/` — window
  hardening + CSP. `sessions/` — append-only JSONL session store.
  `settings/`, `ipc/` (`handlers.ts`), `window/`.

### `src/preload/index.ts`
The typed `window.modelith` bridge: `chat`, `keys` (set/delete/has only),
`workspace`, `mcp`, `git`, `sessions`, window controls. Adding an IPC call means
touching **shared/ipc.ts (zod schema) → main/ipc/handlers.ts → preload → renderer
store** together.

### `src/renderer/`
- `state/store.ts` — the Zustand store; the hub for sessions, streaming, agent
  mode, diff gate, trust flag, canvas, workspace tree.
- `chat/` — `Composer`, `DiffGate`, `WorkspacePanel`, `WorkspaceTree`,
  `MessageView`, mode menu, etc. `canvas/` — the sandboxed artifact pane.
  `sessions/`, `settings/`, `app/` (shell, theme, icons).

### `src/shared/`
`types.ts`, `ipc.ts` (zod request/response schemas — the IPC contract),
`attachments.ts`, `command-safety.ts` (`commandMatchesAllowedPrefix`, rejects
shell operators).

---

## Conventions

- **TypeScript strict + ESM.** Relative imports MUST carry the `.js` extension
  (`import { x } from './foo.js'`), even for `.ts` sources. Renderer uses the
  `@shared/*` path alias.
- **Commits:** `type: summary` (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `chore:`) with the *why* in the body when non-obvious.
- **File size:** prefer small, single-responsibility files. If one grows
  unwieldy while you're in it, a focused split is welcome; don't do unrelated
  refactors.
- **Follow existing patterns** — match the surrounding code's naming, comment
  density, and idiom.

---

## Gotchas (these have bitten before)

- **Run `npm run build` before Playwright** if you ran it directly rather than via
  `npm run test:e2e` — a stale `out/` bundle makes e2e test the *old* UI.
- **electron-builder auto-publishes on a git tag.** The `dist` script pins
  `--publish never`; the GitHub release is created by the workflow's release job,
  not by electron-builder. Don't re-introduce implicit publishing.
- **CRLF warnings** ("LF will be replaced by CRLF") on Windows are harmless.
- **Fake provider for tests:** e2e launches with `MODELITH_FAKE_PROVIDER=1`;
  prompt-triggered behaviors (e.g. `agent multiwrite`, `agent search`) live in
  `src/main/providers/registry.ts`. `MODELITH_WORKSPACE_ROOT` seeds a workspace
  without the native dialog.
- **The provider contract suite is the source of truth** for provider behavior —
  count its `it(...)` blocks rather than trusting any hard-coded number.

---

## Where to look

- **Adding a provider:** [`CONTRIBUTING.md`](CONTRIBUTING.md) — a 20-minute,
  step-by-step guide. This is the best first contribution.
- **Why the big decisions were made:** [`docs/adr/`](docs/adr/) (Electron over
  Tauri, React renderer, BYO-key/no session scraping, the provider contract
  suite).
- **Feature designs & implementation plans:**
  [`docs/superpowers/specs/`](docs/superpowers/specs/) and
  [`docs/superpowers/plans/`](docs/superpowers/plans/).
- **QA / security reviews:** [`docs/qa/`](docs/qa/).
- **Changelog:** [`CHANGELOG.md`](CHANGELOG.md).
