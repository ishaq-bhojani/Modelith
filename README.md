# Open Coder

**Watch it build, see it render — against any model, without an IDE.**

A desktop-native, provider-agnostic, agent-first workspace. Not a VS Code extension, not a terminal tool, not a chat-only app — the space between.

## Status: v0

v0 ships **streaming chat against multiple providers** — one file per provider, hardened Electron shell, encrypted local key storage, session persistence. It does not yet ship the artifact canvas (a sandboxed live-render pane for model-generated HTML/SVG/Mermaid/JSX): that is a separate, in-progress plan built on top of this foundation. If you're looking for "paste an HTML block and watch it render," that piece isn't here yet — this repo is the chat/provider/security substrate it will sit on.

## Supported providers

- **Anthropic** (Claude) — SSE streaming
- **Ollama** — local runtime, newline-delimited JSON, no API key required
- Any **OpenAI-compatible** `chat/completions` endpoint, including out of the box: **Kimi (Moonshot)**, **OpenRouter**, **DeepSeek**, **Groq**, **LM Studio** (local)

Adding another provider is a documented, test-verified path — see [CONTRIBUTING.md](./CONTRIBUTING.md#add-a-provider-in-20-minutes).

## Quick start

Requires Node **>= 22.19.0**.

```bash
npm ci
npm run dev
```

Open Settings in the app, pick a provider, and paste an API key (skip this step for Ollama — it needs none). Start chatting.

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

## License

Apache License 2.0 — see [LICENSE](./LICENSE). Copyright 2026 Open Coder Contributors.
