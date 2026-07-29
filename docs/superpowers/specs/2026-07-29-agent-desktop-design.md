# Open Coder — v0 Design Spec

**Date:** 2026-07-29
**Status:** Approved for planning
**Scope:** v0 (originally Phases 1–4). MCP/tools, file access, visual editing, plugin API, and packaging are explicitly deferred.

---

## 1. What this is

A desktop-native, provider-agnostic, agent-first workspace that is neither an IDE nor a terminal.

The one-sentence positioning: **watch it build, see it render — against any model, without an IDE.**

### 1.1 Why this gap exists

| Existing tool | Shape | Gap |
|---|---|---|
| Cline / Roo Code | VS Code extension | Trapped in VS Code; sidebar webview leaves no room for a design surface |
| Continue | IDE extension | Autocomplete/chat oriented, not agent-first |
| Aider | Terminal, git-native | No GUI |
| OpenHands | Dockerized agent + web UI | Heavy, ops-oriented, not a desktop app |
| Void | Cursor fork | Inherits VS Code's maintenance burden; competes on Cursor's terms |
| Onlook | Electron visual editor | Design-first and React/Next-specific, not a general agent |
| Claude / ChatGPT Desktop | Chat + MCP | Cannot meaningfully work a codebase |

Every serious coding agent requires adopting VS Code or a terminal. Every good desktop chat app cannot touch code. v0 targets the space between.

### 1.2 v0 success criteria

1. A user installs the app, pastes an API key for any supported provider, and gets streaming chat within 60 seconds.
2. When the model emits HTML/SVG/Mermaid/JSX, it renders live in a sandboxed canvas beside the chat.
3. A contributor adds a new provider in under 20 minutes, and the shared contract test suite verifies it without maintainer review of streaming internals.
4. All security invariants are enforced by CI-failing tests, not documentation.

### 1.3 Non-goals for v0

Deferred deliberately, not forgotten:

- MCP client and tool-calling loop
- Filesystem and git access
- Visual point-and-edit editing (DOM → source mapping)
- Plugin/extension API
- Installer packaging and auto-update

The plugin API is deferred on principle: it should be extracted from seams that actually appear during use, not designed speculatively. Linux earned contributors by working first.

---

## 2. Decisions and rationale

| Decision | Choice | Rationale |
|---|---|---|
| Shell | **Electron** | Bundled Chromium renders the artifact canvas identically on all three platforms. Since a rendering canvas *is* the differentiator, per-platform webview divergence (notably WebKitGTK on Linux) is disqualifying for Tauri. Node in main also unblocks the MCP stdio SDK in a later phase. Cost accepted: ~150 MB installers. |
| Renderer | **React + TypeScript + Vite** | Largest contributor pool, which is the dominant factor in whether an OSS side project receives PRs. TypeScript types the IPC contract end-to-end so main and renderer cannot drift. Streaming-token performance is a solved problem here and will not be the bottleneck. |
| Auth | **BYO API key, multi-provider** | No webview session scraping. Scraping is brittle, vendor-specific, and a legal liability in a public repo. Keys are stored via OS-backed encryption. |
| License | **Apache-2.0** | Permissive with an explicit patent grant, which is why employers permit contribution to it. |

### 2.1 Rejected: webview session capture

The original plan proposed loading `https://moonshot.cn` in an embedded view and intercepting auth headers and session cookies. Rejected because it: breaks on any login-flow change; is almost certainly contrary to the provider's terms of service; hard-codes a single vendor into the architecture; and blocks community adoption of a public repository.

---

## 3. Architecture

### 3.1 Trust boundary

```
┌─ Main process (Node) ──────────────────── trusted ─┐
│  secrets · provider adapters · HTTP/SSE            │
│  session persistence · window lifecycle            │
└──────────────┬─────────────────────────────────────┘
               │ preload contextBridge (typed, narrow)
┌──────────────┴─ Renderer (React) ──── semi-trusted ─┐
│  UI only. No node. No API keys. No provider fetch.  │
│   ┌─ Canvas <iframe> ─────────── untrusted ───────┐ │
│   │ agent-generated code. null origin. no egress. │ │
│   └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Invariant:** the renderer never holds an API key and never issues a request to a provider. All provider traffic originates in main.

This single rule makes the security story defensible and additionally buys system-proxy discovery, centralized retry, and streams that survive renderer re-renders.

### 3.2 Window configuration

`BrowserWindow` is created with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and no remote module. A CSP is applied via the session's response-header interceptor. Navigation and new-window handlers deny all destinations outside the app's own origin; external links open in the system browser.

### 3.3 Module layout

```
src/main/
  index.ts                 app lifecycle, window creation
  security/csp.ts          CSP, permission handler, navigation guards
  secrets/keystore.ts      safeStorage-encrypted, OS-backed key storage
  providers/
    types.ts               Provider interface — THE contribution surface
    openai-compat.ts       shared base: Kimi, OpenRouter, DeepSeek, Groq, LM Studio
    anthropic.ts
    ollama.ts
    registry.ts
  chat/
    stream-engine.ts       orchestrates one turn, emits StreamEvent
    sse-parser.ts          pure function, unit-tested
    fence-scanner.ts       incremental artifact detection
    context-budget.ts      history trimming policy
  sessions/store.ts        append-only JSONL per session
  ipc/
    channels.ts            single source of truth: names + payload types
    handlers.ts

src/preload/
  index.ts                 contextBridge surface, typed against ipc/channels

src/renderer/
  app/                     shell, layout, routing
  chat/                    transcript, composer, message rendering
  canvas/                  artifact pane + harness bridge
  settings/                provider and key configuration
  state/                   store, stream subscription
```

Files are kept narrow and single-purpose. A file that grows large is treated as a signal that it holds more than one responsibility.

---

## 4. Provider layer

### 4.1 Interface

```ts
interface Provider {
  id: string
  label: string
  listModels(cfg: ProviderConfig): Promise<ModelInfo[]>
  streamChat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>
}

type StreamEvent =
  | { type: 'text';      delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'done';      usage?: Usage }
  | { type: 'error';     error: ProviderError }
```

Normalization is on **our** internal shape, not on OpenAI's wire format. Adopting the OpenAI wire format as the internal contract would make Anthropic and Ollama second-class citizens bent through an ill-fitting adapter.

`AsyncIterable` + `AbortSignal` provides cancellation and backpressure natively and is trivial to fake in tests.

### 4.2 Contribution path

Adding a provider is: one file implementing `Provider`, one line in `registry.ts`, one fixture set. The shared contract suite (§8.2) then verifies it. This is the primary designed-for contribution and is documented as the flagship good-first-issue.

### 4.3 v0 provider set

`openai-compat` (covering Kimi/Moonshot, OpenRouter, DeepSeek, Groq, LM Studio, and any other OpenAI-compatible endpoint), `anthropic`, and `ollama`.

### 4.4 Key storage

Keys are written through Electron's `safeStorage` (OS keychain–backed encryption) and never transit to the renderer. The renderer may query *whether* a key is configured, and may set or delete one, but may not read one back.

---

## 5. Streaming

### 5.1 Pipeline

Renderer dispatches a send → main's `stream-engine` builds the request, applies the context budget, and calls the provider → provider yields `StreamEvent`s → engine forwards them over IPC → renderer appends to the in-flight message.

### 5.2 Stream identity

Each turn is assigned a **`streamId`**. Every IPC chunk carries it. This routes chunks to the correct message when multiple sessions stream concurrently, and lets the renderer discard in-flight chunks belonging to an aborted turn.

Sequence numbers are deliberately **not** used: Electron IPC over a single channel is already ordered, so they would add payload weight and reconstruction logic for a problem that does not exist.

### 5.3 SSE parsing

`sse-parser.ts` is a pure incremental function: it accepts a chunk plus prior residual buffer and returns complete records plus new residual. It handles records split across arbitrary chunk boundaries, strips the `data: ` prefix, recognizes `[DONE]`, and skips comment/heartbeat lines. Being pure makes it exhaustively testable.

### 5.4 Context budgeting

History that exceeds the model's budget is trimmed by dropping the **oldest complete user/assistant pairs** (the system message is always retained). Trimming is **visible**: the transcript renders an explicit `⋯ N earlier messages omitted` marker, and the composer shows a live context meter.

Silent truncation is rejected — it removes information the user believes is still present, which is precisely the kind of invisible failure that destroys trust in an agent tool.

### 5.5 Cancellation

Stopping a turn aborts the underlying request via `AbortSignal`, marks the partial assistant message as incomplete, and persists what arrived. Partial output is never discarded.

---

## 6. Artifact detection and canvas

### 6.1 Fence scanner

Artifact detection uses an **incremental fence scanner** — a state machine over the token stream tracking fence open/close, language tag, and byte offsets — rather than regular expressions over partial text.

Regex over a partial stream is rejected because half-arrived fences, nested backticks, and language tags split across chunk boundaries all defeat it.

Routing is by language tag: `html`, `svg`, `mermaid`, and `jsx`/`tsx` route to the canvas; all other languages render as ordinary code blocks in the transcript.

### 6.2 Transcript treatment

Artifact code is **not** stripped from the conversation. It collapses to a compact card — `index.html · 84 lines · Open in canvas` — which preserves transcript legibility on scroll-back, keeps copy-to-clipboard working, and allows a single conversation to accumulate multiple artifacts the user can switch between.

### 6.3 Canvas isolation

The canvas `<iframe>` uses `sandbox="allow-scripts allow-modals"` and **never** `allow-same-origin`. The combination of `allow-scripts` and `allow-same-origin` permits a frame to remove its own sandbox attribute and is a documented escape.

### 6.4 Harness update mechanism

The iframe loads a **fixed minimal harness document once**. Artifact updates are delivered by `postMessage`; the harness writes them into its own DOM.

Direct `iframe.contentWindow.document.write()` is rejected: it requires same-origin access to `contentWindow`, which would force `allow-same-origin` and defeat §6.3. Replacing `srcdoc` per update is also rejected — it forces a full reload, causing flicker and destroying scroll position and script state on every streamed token.

The harness approach yields a stable null origin, no reload, and no flicker.

### 6.5 Canvas egress

The harness carries a strict internal CSP that blocks outbound network requests by default, so agent-generated code cannot exfiltrate data or silently contact third parties. The user may opt in per artifact when external resources are genuinely wanted.

### 6.6 Update cadence

During streaming, canvas updates are applied on complete block boundaries or after ~250 ms of token idle, whichever comes first — enough to feel live without re-layout thrash on every token.

---

## 7. UI

### 7.1 Layout

Three zones: a collapsible sessions sidebar, the chat transcript and composer, and the canvas pane.

The canvas pane does not exist until an artifact appears, then slides in. The app therefore presents as a clean, uncluttered chat application until the moment it needs to be more.

### 7.2 Splitter

The chat/canvas splitter uses pointer capture with a transparent overlay covering both panes during drag, which prevents focus loss when the pointer crosses the iframe boundary. Widths are applied via CSS custom properties.

### 7.3 Transcript rendering

The message list is memoized per message so that streaming appends re-render only the in-flight message. Auto-scroll follows the stream but disengages the moment the user scrolls upward, and re-engages when they return to the bottom.

### 7.4 Error presentation

Errors carry a taxonomy, each mapped to exactly one inline recovery action:

| Kind | Inline action |
|---|---|
| `auth` | Open settings |
| `rate_limit` | Retry in *n*s (live countdown) |
| `context_overflow` | Retry with fewer messages |
| `network`, `provider_5xx` | Retry |
| `aborted` | none (silent) |

Raw stack traces never appear in message bubbles. Partial output is preserved and marked incomplete.

---

## 8. Persistence

Sessions are stored as append-only JSONL at `userData/sessions/<id>.jsonl`.

Append-only is chosen because it is crash-safe, avoids rewriting the whole file per token, and remains hand-inspectable — which matters for an open-source tool that contributors will need to debug. Session metadata (title, provider, model, timestamps) lives in a separate lightweight index.

---

## 9. Testing

### 9.1 Unit (Vitest)

`sse-parser`, `fence-scanner`, `context-budget`, and `keystore` are pure or near-pure and are tested exhaustively. The fence scanner is additionally property-tested: the same source document is fed through every possible chunking and must yield identical artifacts.

### 9.2 Provider contract suite

A single shared test suite that every provider must pass, run against recorded fixtures. This is load-bearing for the community strategy: it lets a stranger's "add Mistral" PR verify itself, so a maintainer can merge it without hand-auditing streaming logic.

### 9.3 E2E (Playwright + Electron)

Launch the app against a fake provider, send a message, and assert streamed text arrival, artifact card creation, and canvas render.

### 9.4 Security invariants as executable tests

Enforced in CI, failing the build:

- `contextIsolation === true`
- `nodeIntegration === false`
- `sandbox === true`
- the canvas iframe's sandbox attribute never contains `allow-same-origin`
- no renderer-originated request carries an API key
- the renderer cannot read a stored key back through the IPC surface

These run from Phase 1 onward. A security invariant verified only at the end of a project is one that has already been violated during it.

---

## 10. Repository and community

- **License:** Apache-2.0
- **CI:** Windows, macOS, Linux
- **`docs/adr/`:** architecture decision records, starting with the four decisions in §2
- **`CONTRIBUTING.md`:** headline good-first-issue is *"Add a provider in 20 minutes"*, with a worked example

The provider interface is the deliberate on-ramp that converts readers into committers. Every other extension point in v0 is subordinate to keeping that path short.

---

## 11. Build order

1. **Shell and security** — Electron scaffold, hardened `BrowserWindow`, CSP, typed IPC channel definitions, security invariant tests. (§3.2, §9.4)
2. **Secrets and settings** — keystore, provider configuration UI, key set/delete/probe. (§4.4)
3. **Provider layer and streaming** — `Provider` interface, `openai-compat`, SSE parser, stream engine, `streamId` routing, contract suite. (§4, §5, §9.2)
4. **Chat UI** — transcript, composer, streaming render, auto-scroll behavior, error taxonomy. (§7)
5. **Sessions** — JSONL store, sidebar, context budgeting with visible trim markers. (§5.4, §8)
6. **Canvas** — fence scanner, artifact cards, sandboxed harness, postMessage bridge, splitter. (§6, §7.1–7.2)
7. **Remaining providers** — `anthropic`, `ollama`, each via the contract suite.
