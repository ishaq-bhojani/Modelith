# 0003: Bring-your-own API key, no session scraping

## Context

An early plan for onboarding considered loading a provider's web chat (e.g. `https://moonshot.cn`) in an embedded webview and intercepting the resulting auth headers or session cookies, so a user could authenticate "for free" without ever handling an API key. This was rejected before any implementation.

## Decision

Every provider is authenticated with a user-supplied API key (or, for local runtimes such as Ollama, no credential at all — `requiresKey: false` in `src/main/providers/types.ts`). Keys are written through Electron's `safeStorage` (OS-keychain-backed encryption, `src/main/secrets/keystore.ts`) and never transit to the renderer: the preload bridge (`src/preload/index.ts`) exposes `keys.set`, `keys.delete`, and `keys.has`, and deliberately no `keys.get` or equivalent read path.

Session-cookie scraping was rejected for four independent reasons, any one of which would have been sufficient:

- **Brittle.** It breaks on any change to a provider's login flow, with no upstream contract to depend on.
- **Contrary to terms of service.** Intercepting session auth to drive API-shaped traffic is almost certainly a ToS violation for most providers, and shipping that as default behavior in a public repository is a liability the project does not want to hold.
- **Vendor-specific.** It hard-codes a single provider's login flow into the architecture, defeating the entire point of a provider-agnostic app.
- **Blocks adoption.** A public repository that ships credential-scraping code invites exactly the scrutiny that ends OSS projects.

## Consequences

- Onboarding requires the user to obtain and paste an API key (or, for Ollama, nothing) into Settings — slightly more friction than "sign in with your existing session," but the only version of the flow that survives a security review.
- The trust boundary in `src/main/` (all provider traffic and all secrets) versus `src/renderer/` (UI only) is a direct consequence of this decision, not an independent one: no scraping design means the renderer never needs credential material at all.
- This is enforced as an executable invariant, not just a convention: `tests/e2e/preload-bridge.spec.ts` and `tests/e2e/security.spec.ts` assert the bridge exposes no key-reading method, and the provider contract suite (`tests/contract/provider-contract.ts`) asserts no error message ever echoes the API key back.
