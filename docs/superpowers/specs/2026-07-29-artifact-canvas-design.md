# Artifact Canvas — Design Spec

**Date:** 2026-07-29
**Status:** Approved for planning. Implementation deferred — a UI design pass lands first.
**Depends on:** v0 core chat desktop (merged at `107d763`)
**Roadmap items:** 8 (live canvas), 9 (point-and-refine), 12 (multi-artifact tabs)

---

## 1. What this is

The feature the product's positioning promises: *watch it build, see it render.* When a model
emits renderable markup, it appears live in a sandboxed pane beside the conversation, updating
as it streams. Clicking an element in that pane and describing a change refines it.

Without this, Open Coder is another chat app with good provider support. With it, it is the
only provider-agnostic desktop tool where you can watch a model build something and point at
the result.

### 1.1 Success criteria

1. A model asked for a landing page produces visible, rendering output *while it types* — not
   after it finishes.
2. Asking for a change updates the same artifact rather than accumulating near-duplicate copies.
3. Clicking a button in the rendered output and typing "make this green" changes that button.
4. Nothing rendered in the canvas can reach the network, and that is proven by a test rather
   than asserted in a comment.

### 1.2 Non-goals for this spec

Deferred to their own specs, each a separate roadmap item:

- **JSX/TSX rendering** (needs an esbuild transform in main, React inside the sandbox, and a
  render error boundary — a materially different problem)
- **Version scrubber with diffing** (roadmap 10)
- **Responsive and theme presets** (roadmap 11)
- **Export and eject** (roadmap 13)

---

## 2. Decisions and rationale

| Decision | Choice | Rationale |
|---|---|---|
| Renderers | **html, svg, mermaid** | All three are "put markup in the DOM" with no build step. Covers landing pages, diagrams, charts, logos and mockups — the overwhelming majority of what people ask a model to draw. |
| Artifact identity | **One artifact per language; new blocks are versions** | Matches the dominant workflow: iterating on one thing. "Make the heading bigger" produces a full rewrite, which must not create a second tab. |
| Refinement input | **Chip in the existing composer** | One input, one transcript, full history. Every refinement stays a visible turn that can be scrolled back, branched from, or replayed on another model. |
| Mermaid location | **Renderer, not the sandbox** | Compiling to SVG before it crosses the boundary keeps a ~1 MB dependency out of the security perimeter and reduces the harness to two content kinds. |
| Main-process changes | **None** | Artifacts derive from message history, so no IPC, no persistence, and no contact with the stream engine's concurrency invariant. |

### 2.1 Rejected: model-declared artifact identifiers

Asking the model to tag artifacts with an id in the fence info string is more precise when it
works. Rejected because the project is deliberately provider-agnostic and supports small local
models, where instruction-following quality varies enormously. A heuristic fallback would be
required anyway, and maintaining two mechanisms is worse than maintaining the better one.

### 2.2 Rejected: bundling mermaid into the harness

The obvious reading of the original §6 puts all four renderers inside the sandbox. Compiling
mermaid to SVG in the renderer instead means the harness only ever injects HTML or SVG, which
keeps its protocol small enough to test exhaustively, and keeps a large third-party dependency
out of the boundary that protects the user. Mermaid runs with `securityLevel: 'strict'`, and its
output still lands inside the null-origin, no-egress frame, so a mermaid escape is contained.

---

## 3. Architecture

**Artifacts are a pure function of the conversation.** Version *N* of the HTML artifact is the
*N*th ` ```html ` block in the message history. This single choice is what keeps the feature
contained.

```
messages[] + streamingText
        │
        ▼
  fence scanner (pure, incremental)
        │   blocks: { lang, content, complete }
        ▼
  artifact derivation (pure)
        │   Artifact { id, lang, versions[], currentIndex }
        ▼
  canvas pane  ──postMessage──▶  harness (opaque origin, no egress)
                ◀──postMessage──
```

Consequences worth stating explicitly:

- **No new IPC channels and no stream-engine changes.** The engine carries the
  one-turn-per-session invariant that makes `SessionStore`'s unserialized appends safe; a
  rendering feature has no business touching it.
- **No new persistence.** Nothing to store, migrate, or keep consistent. Reloading a session
  re-derives byte-identical artifacts.
- **Streaming falls out for free.** Derivation runs over `messages` *plus* the in-flight
  `streamingText`. A half-arrived `<div>` renders as it types. When `done` fires,
  `streamingText` empties as `messages` gains the same content, so the derived result never
  double-counts or flickers.

### 3.1 New files

```
src/renderer/canvas/
  fence-scanner.ts        incremental block scanner (pure)
  artifacts.ts            derivation: blocks -> Artifact[] (pure)
  harness.ts              the srcdoc constant + message type definitions
  useHarness.ts           mount, ready handshake, throttled render dispatch
  CanvasPane.tsx          toolbar, tabs, version stepper, iframe host
  selection.ts            encode/decode the <selected-element> block (pure)
```

Modified: `src/renderer/app/App.tsx` (mount the pane), `src/renderer/state/store.ts`
(selection state), `src/renderer/chat/MessageView.tsx` (artifact card, selection chip),
`src/renderer/chat/Composer.tsx` (selection chip), `src/renderer/app/theme.css`.

Added dependency: `mermaid`, lazy-imported so it loads only when a diagram first appears.

---

## 4. Fence scanner

An incremental state machine over the token stream, tracking fence open/close, the language
tag, and content offsets. Regular expressions over partial text are rejected: half-arrived
fences, nested backticks, and language tags split across chunk boundaries all defeat them.

It must expose **unterminated** blocks with their content so far, because progressive rendering
of an in-flight artifact is the entire point of the feature.

```ts
export interface Block {
  lang: string
  content: string
  complete: boolean
}

export function scanBlocks(source: string): Block[]
```

The scanner is a pure function over the whole source rather than a chunk-and-residual pair.
Derivation already re-runs on each token and the inputs are small enough that this is cheaper
than maintaining incremental state, and far easier to test.

Routing: `html`, `svg` and `mermaid` (plus the alias `mmd`) route to the canvas. Every other
language renders as an ordinary code block in the transcript, exactly as today.

---

## 5. Artifact model

```ts
export interface Artifact {
  id: string          // the language tag; one artifact per language per conversation
  lang: 'html' | 'svg' | 'mermaid'
  versions: string[]  // content of each block, oldest first
  currentIndex: number
}

export function deriveArtifacts(messages: ChatMessage[], streamingText: string): Artifact[]
```

Rules:

1. Only assistant messages contribute blocks. A user pasting HTML does not create an artifact.
2. Blocks are collected in conversation order, then in document order within a message.
3. The first block of a language creates its artifact; each subsequent block of that language
   appends a version.
4. `currentIndex` defaults to the newest version. The version stepper moves it; a new arriving
   version jumps back to newest.
5. An incomplete trailing block is a *provisional* version — it replaces rather than appends, so
   a streaming artifact does not create one version per token.

**Escape hatch.** "Branch as new artifact" pins the current version under a new id
(`html#2`), so a user genuinely building a second page is not forced to fight rule 3. The
branch marker lives in renderer state only; on reload the conversation re-derives without it,
which is an accepted limitation of deriving rather than storing.

---

## 6. Harness and isolation

### 6.1 Delivery

The harness is a constant HTML string set once as the iframe's `srcdoc` at mount and never
changed. Updates arrive by `postMessage`. Replacing `srcdoc` per update is rejected: it forces
a full reload, destroying scroll position and script state on every streamed token.

The iframe uses `sandbox="allow-scripts allow-modals"` and **never** `allow-same-origin`. That
combination would let the frame remove its own sandbox attribute, which is a documented escape.

### 6.2 Origin checking

Because the sandbox omits `allow-same-origin`, the frame has an **opaque** origin and
`event.origin` is the literal string `"null"`. It is useless for validation. Both sides must
check source identity instead:

- Parent accepts a message only when `event.source === iframe.contentWindow`.
- Harness accepts a message only when `event.source === window.parent`.

Getting this wrong turns the sandbox into a message-injection surface.

### 6.3 Protocol

```
parent → harness   { type: 'render', kind: 'html' | 'svg', content: string }
                   { type: 'selectMode', enabled: boolean }
harness → parent   { type: 'ready' }
                   { type: 'selected', outerHTML: string, path: string }
                   { type: 'error', message: string }
```

The parent queues renders until `ready` arrives.

### 6.4 Egress

The harness document carries its own policy:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:
```

`script-src 'unsafe-inline'` is deliberate — model-authored scripts *should* run; that is what
makes the canvas live. What is forbidden is the network. `default-src 'none'` blocks `fetch`,
`XMLHttpRequest`, WebSockets, remote images, and remote fonts, so generated code cannot
exfiltrate the conversation or silently call a third party.

Per-artifact opt-in relaxes this to permit `https:` sources. Because CSP is fixed at document
load, opting in remounts the harness — acceptable, as it follows an explicit user action.

### 6.5 Update cadence

During streaming, renders dispatch on complete-block boundaries or after ~250 ms of token idle,
whichever comes first. Derivation runs per token; only the `postMessage` is throttled.

---

## 7. Point-and-refine

In select mode the harness outlines elements on hover and captures the next click
(`preventDefault`, `stopPropagation`, capture phase). It returns the element's `outerHTML`,
truncated to 2 KB, plus an nth-child path for disambiguation.

The renderer shows a dismissible chip above the composer. On send, the renderer composes the
message content itself:

```
<selected-element>
<button class="cta">Sign up</button>
</selected-element>

make this green
```

**This block is part of the persisted content, not a hidden prompt augmentation.** `MessageView`
collapses it into a chip when rendering. The transcript therefore shows what was actually sent,
the message round-trips on reload, it can be replayed on another model, and the future context
inspector stays truthful. It also means the stream engine keeps mapping `m.content` straight
through, so main needs no changes.

The system does not attempt a partial patch. The model returns the complete updated document,
which becomes the next version — consistent with how models actually behave, and versioning
makes the cost of a full rewrite invisible.

---

## 8. UI

> **Pending visual design.** This section specifies structure and behaviour. Layout, spacing,
> and visual treatment come from a design pass that lands before implementation.

- The canvas pane appears when the active session has at least one artifact, and is absent
  otherwise — the app stays a clean chat window until it needs to be more.
- A splitter separates chat from canvas, using the pointer-capture pattern already established
  in `src/renderer/app/Splitter.tsx`, including its keyboard operability.
- The canvas toolbar carries: one tab per artifact, a version stepper (`v3 of 5`), a select-mode
  toggle, and the network opt-in toggle.
- In the transcript, a routed block collapses to a card — `index.html · 84 lines · Open in
  canvas`. Code is **not** stripped: scroll-back stays legible and copy-to-clipboard keeps
  working.
- Rendering a partial artifact must never show a flash of unstyled or broken content; the
  harness swaps content in a single write.

---

## 9. Errors

| Condition | Behaviour |
|---|---|
| Mermaid fails to compile | Show the parser message and the offending source in the canvas; the previous version stays reachable. A broken diagram never blanks the pane. |
| Artifact exceeds 2 MB | Refuse to render, show a notice with the size. Protects the frame from a runaway generation. |
| Harness never signals `ready` | Show a fallback message rather than an empty box. |
| Harness reports an error | Surface it in the canvas, keep the pane alive. |
| Selected element no longer exists after a re-render | Clear the chip silently; the user can reselect. |

---

## 10. Testing

**Unit**

- `fence-scanner` — property test feeding the same document through **every possible chunking**
  and asserting identical blocks. This is the discipline that has kept `sse-parser` defect-free.
  Plus: unterminated blocks, nested backticks, unknown languages, a language tag split across a
  boundary.
- `artifacts` — identity and versioning rules 1–5, including the provisional-version rule that
  prevents one version per token.
- `selection` — encode/decode round-trip, including content containing the delimiter itself.
- Mermaid compile wrapper — success and failure paths.

**E2E**

- A fake provider emits an `html` block; the canvas renders it.
- A second `html` block produces `v2` of the same artifact, not a second tab.
- A `mermaid` block produces a separate tab.
- Select mode: clicking an element populates the composer chip.

**Security, executable rather than asserted**

- The canvas iframe's `sandbox` attribute never contains `allow-same-origin`.
- **A `fetch()` executed inside the harness fails.** §6.4 makes a security claim; this project's
  history is that an untested security claim is frequently a false one — the CSP was a no-op in
  packaged builds for eight tasks, and the development window rendered blank because no test
  covered that path.
- A `postMessage` from an unexpected source is ignored by both sides.

---

## 11. Build order

1. **Fence scanner** — pure, property-tested, no UI.
2. **Artifact derivation** — pure, the identity and versioning rules.
3. **Harness** — srcdoc constant, ready handshake, source-identity checks, egress test.
4. **Canvas pane** — mount, splitter, throttled render dispatch, HTML and SVG.
5. **Mermaid** — lazy import, compile to SVG, error path.
6. **Transcript integration** — artifact cards replacing routed fences.
7. **Tabs and version stepper** — multi-artifact navigation, branch action.
8. **Point-and-refine** — select mode, chip, selection encoding, transcript rendering.

Steps 1–2 are pure functions and could be built in either order. Step 3 must precede 4. Step 8
depends on 4 but nothing after it.
