# Known Issues

Findings from the v0 review that were deliberately deferred rather than fixed. None
blocks use of the app. Each is a good first issue — they are small, well-localized, and
come with the reasoning already done.

If you fix one, please also add the test that would have caught it.

## Correctness

**`applyEvent`'s `done` branch lacks the guard its `text` branch has.**
`src/renderer/state/store.ts` — the `text` branch checks `streamId === null` before
accumulating; the `done` branch does not. A `done` racing in after `stop()` would append
a second, empty assistant bubble. No reachable case was found — the stream engine
suppresses emissions after abort, and IPC ordering puts `done` ahead of the abort reply —
but the asymmetry is a trap for the next person editing this file. Add the guard, or
document why it is unnecessary.

**Deltas in flight at Stop are dropped by the renderer but persisted by main.**
The locally appended bubble can therefore be shorter than the copy on disk, and silently
grows when the session is reloaded. Cosmetic, but confusing if you notice it.

**The error path clears the partial reply from the live view without appending it.**
Stop appends the partial locally with `incomplete: true`; an error does not. The text
visibly vanishes until the user navigates away and back, at which point it reloads from
disk. Making the two paths symmetric would be an improvement.

**`send()` sets `lastStreamId` only after `chat.send` resolves.**
`src/renderer/state/store.ts` — any event main emits before that resolves is discarded by
the routing gate, notably the synchronous `busy` error the stream engine raises when a
session already has a turn in flight. Largely unreachable today because the composer
shows Stop rather than Send for a streaming session.

## Streams

**`consumeStream` discards its residual when the reader reports done.**
`src/main/providers/stream-consumer.ts` — a provider whose final record arrives without a
trailing newline loses that record. Every provider shipped today newline-terminates, so
the impact is currently nil, but `CONTRIBUTING.md` tells contributors this helper owns
stream correctness, so a contributor whose format differs would have no reason to suspect
it. Either flush the residual at end-of-stream or keep the behavior and test it explicitly.

## Errors

**Errors on a background session are never surfaced.**
If a turn fails while the user is viewing a different conversation, they are never told.
The reply is persisted correctly, but there is no badge, toast, or marker. Deliberate for
v0 to avoid building a notification system; worth revisiting.

**Electron wraps handler errors before they reach the UI.**
IPC rejections surface as `Error invoking remote method 'chat:send': ...` around the clean
message. Not a raw stack trace, but not chat-bubble prose either. Unwrap it in the
renderer's error mapping.

## Tests and tooling

**Nothing tests development mode end to end.**
Every E2E test launches the *built* app over `file://`. Development serves the renderer
over `http://` from Vite, which is a materially different path — different CSP
enforcement, an inline React Refresh preamble, and an HMR websocket. A CSP bug that
blanked the entire dev window shipped through 15 passing E2E tests because of this gap
(see `tests/unit/csp.test.ts` for the regression guard that now covers the policy split).
A dev-mode smoke test that boots the Vite server and asserts the sidebar renders would
close it properly.


**`tests/e2e/layout.spec.ts`'s splitter drag is still occasionally flaky.**
Hardened once with visibility waits, `hover()`, and a polling assertion, but it failed
again during the final review with a partially delivered drag. Pointer-event delivery in
Electron under Playwright is the suspected mechanism. Do not paper over it with
Playwright `retries` — that would hide every future flake too.

**`tests/e2e/chat.spec.ts` races a ~100 ms fake stream.**
Five words at 20 ms each. It passes with 130–700 ms of headroom locally, which is thin for
a loaded CI runner. Giving the fake provider a configurable per-word delay would make it
deterministic.

**No ESLint or Prettier configuration.**
For a project whose growth depends on outside pull requests, this guarantees style
debates that a config would settle. There is already one `eslint-disable` comment in the
codebase with no ESLint to honour it.

**`tests/unit/ipc-contract.test.ts` regex-matches channel names.**
It checks names against `/get.*key|read.*key/`. A key-read channel named `secrets:fetch`
would pass. It is a spelling tripwire, not an invariant test — the real guarantee is the
preload surface, which is tested separately in `tests/e2e/security.spec.ts`.

## Deferred features

These are scoped out of v0 by design, not oversights:

- The sandboxed artifact canvas (the project's headline differentiator) — a separate plan.
- MCP and tool-calling; filesystem and git access.
- Installer packaging and auto-update.
- Custom provider base URLs. Deliberately removed from the renderer-supplied path because
  an unvalidated value could redirect where the API key is sent. Will return as
  main-side configuration.
- The `⋯ N earlier messages omitted` context-trim marker. `applyContextBudget` already
  returns `omittedCount`; nothing renders it yet.
- Syntax highlighting for code blocks in the transcript.
