# Contributing to Open Coder

Thanks for considering it. The single best way in is adding a provider — the interface was designed for exactly this, and the shared test suite verifies your work without a maintainer having to hand-audit streaming internals.

## Add a provider in 20 minutes

Ollama (Task 13, newline-delimited JSON, no credential) and Anthropic (Task 12, SSE, named event types, a `message_stop` sentinel) both dropped into this codebase against two materially different wire formats with **zero changes** to the shared contract suite. Yours will too.

### 1. Pick a starting point and copy it

- `src/main/providers/ollama.ts` — closest starting point if your provider is keyless (a local runtime) or uses a non-SSE wire format.
- `src/main/providers/anthropic.ts` — closest starting point if your provider streams SSE but doesn't speak the OpenAI `chat/completions` shape verbatim.
- If your provider *is* OpenAI-`chat/completions`-compatible (most hosted providers are), you likely don't need a new file at all — add a `createOpenAiCompatProvider({ id, label, defaultBaseUrl })` entry to `src/main/providers/registry.ts` instead. See the Kimi/OpenRouter/DeepSeek/Groq/LM Studio entries already there.

Copy the file to `src/main/providers/<yours>.ts`.

### 2. Implement the `Provider` interface

The interface lives in `src/main/providers/types.ts`:

```ts
export interface Provider {
  readonly id: string
  readonly label: string
  readonly defaultBaseUrl: string
  readonly requiresKey: boolean   // false for local runtimes such as Ollama
  listModels(config: ProviderConfig): Promise<ModelInfo[]>
  streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>
}
```

`StreamEvent` is the normalized shape every provider yields into, regardless of its own wire format:

```ts
type StreamEvent =
  | { type: 'text';      delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'done';      usage?: Usage }
  | { type: 'error';     error: ProviderError }
```

### 3. Use `consumeStream` — do not write your own read loop

`src/main/providers/stream-consumer.ts` exports `consumeStream(body, signal, onChunk)`. It owns:

- reading the response body and decoding chunks,
- cancelling the reader on every exit path,
- the abort race (a signal that fires mid-`read()`),
- emitting exactly one terminal `done`, always last.

**Known assumption:** `consumeStream` discards any residual left in your closure when the reader reports the stream done — it does not flush a final unterminated record. Every provider shipped today newline-terminates its last record, so this has never lost data, but if your wire format can end without a trailing terminator, your `onChunk` needs to account for that itself (or the last record will be silently dropped).

Your job is only to decode *your* wire format. Write a function `(chunk: string) => ChunkResult` where:

```ts
interface ChunkResult {
  events: StreamEvent[]   // events to yield for this chunk, may be empty
  complete?: boolean      // your framing signalled a clean end (e.g. [DONE], message_stop, done: true)
                          // -> consumeStream yields `events`, then a terminal `done`, then returns
  stop?: boolean          // `events` already contains a terminal event (e.g. a mid-stream error)
                          // -> consumeStream yields `events`, then returns, with no added `done`
}
```

**Create this closure inside `streamChat`, once per invocation** (see how `makeOllamaChunkHandler()` / `makeAnthropicChunkHandler()` are called fresh at the top of `streamChat`, not hoisted to module scope). Any residual/buffer state for split chunks lives in the closure. A module-scoped handler would leak buffer state between concurrent streams.

Then:

```ts
yield* consumeStream(response.body, signal, makeYourChunkHandler())
```

### 4. Map HTTP errors with `statusToError`

Import `statusToError` from `src/main/providers/openai-compat.ts`:

```ts
yield {
  type: 'error',
  error: statusToError(response.status, {
    retryAfter: response.headers.get('retry-after'),
    body: bodyText,
  }),
}
```

It maps 401/403 → `auth`, 429 → `rate_limit` (with `retryAfterSeconds` if present), 5xx → `provider_5xx`, and 400 → `context_overflow` or `unknown` depending on the body text. **Never put the API key, or a raw provider response body, into an error `message`** — the contract suite asserts this directly, including against a provider response that tries to echo the key back at you.

`streamChat` must never `throw`. Every failure path — a network error, a non-OK status, a mid-stream error record — yields a `{ type: 'error', ... }` event and returns, or (for a network failure before any bytes arrived while the signal was already aborted) yields a bare `{ type: 'done' }`.

### 5. Add fixtures

Add `tests/fixtures/<yours>.ts` implementing `ContractFixtures` (from `tests/contract/provider-contract.ts`):

```ts
export interface ContractFixtures {
  helloStream: string      // a complete response body that yields exactly "Hello world"
  authErrorBody: string    // a 401 JSON error body
  rateLimitBody: string    // a 429 JSON error body
  modelsBody: string       // a well-formed models-list response body
  contentType?: string     // set this if your wire format isn't SSE (e.g. 'application/x-ndjson')
}
```

Look at `tests/fixtures/ollama.ts` or `tests/fixtures/anthropic.ts` for a concrete example in your wire format.

### 6. Add the contract test

`tests/unit/<yours>.test.ts` is three lines:

```ts
import { runProviderContract } from '../contract/provider-contract.js'
import { yourFixtures } from '../fixtures/<yours>.js'
import { createYourProvider } from '../../src/main/providers/<yours>.js'

runProviderContract('<yours>', createYourProvider, yourFixtures)
```

### 7. Register it

Add one line to `src/main/providers/registry.ts`'s `providers` array.

### 8. Run the suite

```
npm test
```

**14 contract tests** must pass for your provider (identity shape; text deltas ending in exactly one terminal `done`; nothing emitted after `done`; 401/429/503 mapped correctly; a transport failure mapped to `network`; an already-aborted signal short-circuits cleanly; a signal that fires mid-stream still ends in exactly one terminal `done`; the API key never appears in any error message, including one the provider itself tries to echo back; `listModels` returns real models on a well-formed body and an empty list — never a throw — on a malformed or non-OK response). If this count ever looks wrong, `tests/contract/provider-contract.ts` is the source of truth — count its `it(...)` blocks rather than trusting this number, since the suite is expected to grow.

### The rules the suite actually enforces

If you remember nothing else:

1. `streamChat` never throws.
2. Exactly one terminal `{ type: 'done' }`, and it is always the last event.
3. Every failure — network, HTTP status, mid-stream provider error — yields a `{ type: 'error' }` event instead of throwing.
4. No error message, under any circumstance, contains the API key.

## Development setup

- Node **>= 22.19.0** (see `engines` in `package.json`).
- `npm ci` — installs dependencies. A root `.npmrc` sets `legacy-peer-deps=true` because `electron-vite@5` currently declares a peer range (`vite@^5 || ^6 || ^7`) that excludes the pinned `vite@8`; this is a known upstream lag, not a project requirement, and the `.npmrc` line can be deleted once `electron-vite` widens its peer range.
- `npm run dev` — launches the app in development.
- `npm run typecheck` — `tsc --noEmit` against both the app and Node build configs.
- `npm test` — Vitest unit and contract tests (144 tests as of this writing).
- `npm run test:e2e` — builds the app, then runs the Playwright/Electron E2E suite.

## Commit convention

Commits follow a `type: summary` shape — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` — with the *why*, not just the *what*, in the body when it isn't obvious from the subject line.

## The one rule that is never negotiable

**No API key may reach the renderer, under any circumstance.** All provider traffic and all secret handling live in the main process. The preload bridge (`src/preload/index.ts`) exposes `keys.set`, `keys.delete`, and `keys.has` — deliberately no read path. If a change would let the renderer see, log, or forward a key, it does not land, no matter how it's framed. This is enforced as an executable test, not just a convention — see `tests/e2e/preload-bridge.spec.ts`, `tests/e2e/security.spec.ts`, and the contract suite's key-leak assertions.
