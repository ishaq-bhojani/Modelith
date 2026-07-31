# 0002: React renderer

## Context

Modelith is an OSS side project, so contributor pool size is the dominant factor in whether it receives community PRs at all — it is not competing for engineering resources against a company's own roadmap the way a product team's frontend choice might. The renderer also has to communicate cleanly with the main process over IPC (`src/shared/ipc.ts`, `src/preload/index.ts`), and needs to keep up with tokens streaming in from a live chat without becoming the bottleneck.

The realistic alternative considered was a hand-rolled DOM rendering layer: direct `document` manipulation or a small bespoke component abstraction, avoiding a framework dependency entirely.

## Decision

Use React + TypeScript + Vite for `src/renderer/`.

React has by far the largest pool of contributors familiar with its component model, which matters more for a side project's PR volume than any framework-level performance delta. TypeScript types the IPC contract end-to-end — `src/shared/ipc.ts` and `src/shared/types.ts` are imported by both `src/main/ipc/handlers.ts` and `src/preload/index.ts` and the renderer's `src/renderer/state/` store — so the two sides of the process boundary cannot drift silently. Streaming-token rendering performance (`src/renderer/chat/`, memoized per-message so only the in-flight message re-renders on each delta) is a solved problem in React and was not expected to be, and has not been, the bottleneck.

A hand-rolled rendering layer was rejected because it forces every contributor to first learn a bespoke, undocumented convention before they can land a change of any size — directly undermining the "add a provider/fix a bug in one sitting" goal that motivates ADR 0004's contract suite.

## Consequences

- The renderer depends on `react`, `react-dom`, and Vite's React plugin, and every renderer contribution assumes familiarity with function components and hooks.
- `zustand` (`src/renderer/state/`) is used for the streaming/session store rather than React context, keeping the streaming state deliberately outside the component tree.
- Contributors can rely on ordinary React idioms and TypeScript types for the IPC surface instead of reading bespoke rendering internals before their first PR.
