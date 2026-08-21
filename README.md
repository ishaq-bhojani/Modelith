# Modelith

**Watch it build, see it render — against any model, without an IDE.**

A desktop-native, provider-agnostic, agent-first workspace. Not a VS Code extension, not a terminal tool, not a chat-only app — the space between.

## Status: 0.1.0 (first public build)

Modelith is a provider-agnostic agent desktop. Beyond streaming chat it ships:

- **Artifact canvas** — model-generated HTML/SVG/Mermaid render live in a
  sandboxed, no-egress pane; multi-artifact tabs, versions, point-and-refine.
- **Workspace + vision** — open a folder and pull files into context (read-only,
  confined to the folder); attach images to vision-capable models.
- **Agent (opt-in, every action gated)** — edit files behind a diff-approval
  gate with one-click revert; connect **MCP** servers; run **commands** behind an
  approval allow-list; a **git** panel; and **Model Race** (one prompt, 2–4
  models, pick the winner).
- **Project Mode** — a persistent, collapsible project tree with an "Open
  Folder" entry point and auto-restore of the last folder; the agent can
  search file contents (`search_files`) and, with trust-for-this-turn, apply
  a turn's remaining edits from one approval (still one-revert-undoes-it-all).

Every privileged action is approved by you, and the security invariants (no key
to the renderer, no unapproved disk write, confined reads/writes) are covered by
tests. See [CHANGELOG.md](./CHANGELOG.md) for the full list.

## Supported providers

- **Anthropic** (Claude) — SSE streaming
- **Ollama** — local runtime, newline-delimited JSON, no API key required
- Any **OpenAI-compatible** `chat/completions` endpoint, including out of the box: **Kimi (Moonshot)**, **OpenRouter**, **DeepSeek**, **Groq**, **LM Studio** (local)

Adding another provider is a documented, test-verified path — see [CONTRIBUTING.md](./CONTRIBUTING.md#add-a-provider-in-20-minutes).

## Install

Download an installer for your OS from the [Releases](../../releases) page:
Windows (`.exe`), macOS (`.dmg`), Linux (`.AppImage`).

On macOS, pick the file matching your Mac: **`-arm64`** for Apple Silicon (M1 and
later), **`-x64`** for Intel. An Intel build runs on Apple Silicon under Rosetta,
but an Apple Silicon build will not launch on an Intel Mac.

Builds are currently **unsigned**, so Windows SmartScreen and macOS Gatekeeper
will warn on first launch — allow it through (Windows: *More info → Run anyway*;
macOS: right-click → *Open*). Signed builds are on the roadmap.

Then open Settings, pick a provider, and paste an API key (Ollama needs none).

### Projects

Add a folder with **+** in the sidebar and it becomes a project; its chats group
underneath it. Switching projects re-points the file tree without re-picking a
folder. Chats from before you had projects — or any chat started without one —
sit under **Unfiled**, and can be moved into a project from the dropdown that
appears when you hover a chat.

Removing a project forgets the folder. Nothing on disk is touched and no chat is
deleted; its chats move to Unfiled.

## Run / build from source

Requires Node **>= 22.19.0**.

```bash
npm ci
npm run dev          # run in development
npm run dist         # build installers for the current OS (output in release/)
npm run dist:dir     # unpacked build, no installer (faster; for smoke-testing)
```

Before a release, run the automated suite (`npm test && npm run test:e2e`) and
the [real-provider smoke test](./docs/qa/real-provider-smoke-test.md) — the
automated tests use a fake provider, so a live-API pass is required.

## Security model

```
┌─ Main process (Node) ──────────────────── trusted ─┐
│  secrets · provider adapters · HTTP/SSE            │
│  session persistence · window lifecycle            │
└──────────────┬─────────────────────────────────────┘
               │ preload contextBridge (typed, narrow)
┌──────────────┴─ Renderer (React) ──── semi-trusted ─┐
│  UI only. No node. No API keys. No provider fetch.  │
└─────────────────────────────────────────────────────┘
```

The **main process** owns every secret and every network request. API keys are written through Electron's `safeStorage` (OS-keychain-backed encryption) and never leave the main process.

The **renderer** draws the UI only. It runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a restrictive CSP, and never talks to a provider directly.

The **preload bridge** (`src/preload/index.ts`) is the only channel between them, and it is intentionally narrow: it exposes `keys.set`, `keys.delete`, and `keys.has` — there is no `keys.get`. The renderer can ask *whether* a key is configured; it can never read one back. This is verified by executable tests (`tests/e2e/security.spec.ts`, `tests/e2e/preload-bridge.spec.ts`), not just documented as a convention.

### Update checks

Modelith checks GitHub for a new release on launch and every six hours. It is an
anonymous `GET` to the public GitHub API — no identifiers, no usage data, nothing
about your conversations. Turn it off in **Settings → Updates**.

On Windows and Linux a new version downloads in the background and a chip offers
to restart and install. macOS builds are unsigned, and macOS refuses to
auto-install unsigned updates, so there the chip links to the release page for a
manual download.

## Known limitations

- **Custom provider base URLs are not configurable in v0.** The renderer cannot supply a base URL for a provider request — this is deliberate: a renderer-controlled endpoint could redirect where main sends an API key, which the security model above forbids. When this is added, it will be main-side configuration (e.g. a settings file or an IPC call scoped to values the main process validates), never a value passed through on a per-request basis from the renderer.
- **A turn that fails while the user is viewing a different conversation is not surfaced anywhere.** Errors are only shown when the active session matches the one the failing turn belongs to (see `applyEvent` in `src/renderer/state/store.ts`); if the user has navigated away, the failure is silent in the UI (though the partial/incomplete reply, if any, is still persisted and visible on return to that session).

## License

Apache License 2.0 — see [LICENSE](./LICENSE). Copyright 2026 Modelith Contributors.
