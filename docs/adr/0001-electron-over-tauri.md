# 0001: Electron over Tauri

## Context

Modelith's differentiator is a live artifact canvas: when the model emits HTML, SVG, Mermaid, or JSX, it renders in a sandboxed pane beside the chat, identically, on Windows, macOS, and Linux. The shell choice therefore had to be evaluated primarily on rendering-engine consistency, not on binary size or memory footprint, since those are the usual reasons to prefer a lighter alternative.

Tauri was the leading alternative: it ships no bundled browser engine and produces installers an order of magnitude smaller than Electron's.

## Decision

Use Electron.

Electron bundles Chromium, so the canvas renders identically across platforms. Tauri instead delegates to the OS-provided webview — WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux — and WebKitGTK in particular lags upstream WebKit and diverges from the other two in ways that would surface as canvas rendering bugs specific to one platform. A rendering surface that behaves differently depending on which OS the user happens to run is disqualifying when the rendering surface is the product's reason to exist.

Electron's main process also runs Node, which keeps the door open for the MCP stdio SDK in a later phase without a second runtime bridge. Tauri's Rust-only extension model would additionally have restricted the contributor pool to people comfortable writing Rust, which cuts against an OSS strategy that depends on the provider on-ramp (ADR 0004) drawing outside contributions.

## Consequences

- Installers are roughly 150 MB, an accepted cost for guaranteed cross-platform rendering parity.
- The renderer, main process, and IPC bridge (`src/preload/index.ts`) all run on a Node/Chromium foundation with a large existing contributor base and abundant prior art for hardening (`contextIsolation`, `sandbox`, CSP — see `src/main/security/`).
- Electron's larger attack surface (a full Chromium + Node runtime) is mitigated, not avoided, by the trust-boundary and window-hardening work in Tasks 1–3, and is re-verified by the security invariant tests in `tests/e2e/security.spec.ts` on every CI run rather than trusted to documentation.
