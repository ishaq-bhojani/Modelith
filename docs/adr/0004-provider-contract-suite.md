# 0004: Provider contract suite

## Context

Modelith's stated on-ramp for outside contributors is "add a provider in 20 minutes." That promise is worthless if landing a provider PR still requires a maintainer to hand-audit the contributor's streaming/parsing code line by line — SSE framing, abort races, and error-status mapping are exactly the kind of logic that is easy to get subtly wrong and tedious to review by eye.

The alternative considered was per-provider ad hoc tests: each provider file ships whatever tests its author thought to write, reviewed case by case.

## Decision

Every provider is verified by one shared suite, `runProviderContract` in `tests/contract/provider-contract.ts`, run against a small set of fixtures the provider author supplies (`ContractFixtures`: `helloStream`, `authErrorBody`, `rateLimitBody`, `modelsBody`, optional `contentType`). The suite is wire-format-agnostic — it drives the `Provider` interface (`streamChat`, `listModels`) and asserts only on the normalized `StreamEvent` shape, never on a provider's specific framing. A provider's entire unit test file is three lines: import the suite, import the fixtures and factory, call `runProviderContract(id, factory, fixtures)`.

The suite currently asserts 14 behaviors per provider, including: stable identity; text deltas followed by exactly one terminal `done`, always last; no event after `done`; 401 → `auth`, 429 → `rate_limit`, 503 → `provider_5xx`; a transport failure maps to `network` without throwing; an already-aborted signal and a signal that fires mid-stream both end in exactly one terminal `done` without throwing; the API key never appears in any error message, including when a provider's own error body tries to echo one back; and `listModels` returns models on success and an empty list — never a throw — on a malformed or non-OK response.

This was proven, not merely designed: Anthropic (Task 12 — SSE framing, named event types, a `message_stop` sentinel) and Ollama (Task 13 — newline-delimited JSON, `done: true` sentinel, no credential at all) both dropped in against two materially different wire formats and credential models with **zero changes to the shared suite**. The suite's job was to verify each new file, not to be edited to accommodate it.

## Consequences

- A stranger's "add Mistral" or "add Groq-alike" PR is mechanically verifiable: if `npm test` passes, the streaming, abort, and error-mapping behavior a maintainer would otherwise have had to trace by hand is already covered.
- New providers must express their wire format as a `(chunk: string) => ChunkResult` closure consumed by `consumeStream` (`src/main/providers/stream-consumer.ts`), which is what makes the suite genuinely wire-format-agnostic rather than SSE-shaped with an escape hatch.
- The suite is deliberately conservative about what it fixes in place (the normalized `StreamEvent` union in `src/shared/types.ts`) versus what it leaves to each provider (framing, sentinel detection, status-to-error mapping via `statusToError`). Extending the normalized event shape is a rarer, higher-scrutiny change than adding a provider.
