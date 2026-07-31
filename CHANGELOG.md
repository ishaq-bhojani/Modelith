# Changelog

All notable changes to Open Coder are recorded here. Dates are ISO (UTC).

## 0.1.0 — 2026-07-31 (first public build)

The first release with installers. A provider-agnostic agent desktop:
bring your own key (or run a local model), watch artifacts build, and let the
agent read, edit, and run — every privileged action behind an approval gate.

### Chat & providers
- Streaming chat against Anthropic, OpenAI-compatible providers (OpenRouter,
  Kimi, DeepSeek, Groq, LM Studio) and Ollama; API keys stored in the OS
  keychain and never exposed to the renderer.
- Per-turn cost, model/provider provenance, within-turn failover to a fallback.
- Sessions persisted as append-only JSONL; edit, fork, side threads, context
  inspector, secret-paste guard, Modes (system-prompt presets), auto-titled chats.

### Artifact canvas
- Live HTML / SVG / Mermaid rendering in a sandboxed, no-egress frame
  (hash-pinned inline script; `fetch` inside the frame fails by design).
- Multi-artifact tabs, version stepper, branch-as-new-artifact, "Open in canvas"
  transcript cards, point-and-refine (select an element and describe a change),
  and a collapsible pane.

### Workspace & vision
- Open a folder and pull files into context; reads confined to the chosen root
  (realpath + traversal/symlink checks), never written.
- Image attachments to vision-capable models.

### Agent (opt-in, gated)
- Tool-calling loop with a **diff-approval gate** and one-click **checkpoints/revert**.
- **MCP** client — connect stdio servers, call their tools (each call approved).
- **Terminal + git** — run commands behind a per-command approval and a
  user-defined session allow-list; a view-only git panel (branch/status/diff).
- **Model Race** — send one prompt to 2–4 models at once and pick the winner.

### Packaging
- Installers for Windows (NSIS + zip), macOS (dmg), and Linux (AppImage) via a
  tag-triggered release workflow. Unsigned in this build.

### Security (pre-launch review)
- git runs via an argument vector (no shell), closing a command-injection vector
  from hostile repo filenames; the command allow-prefix rejects chained/piped
  commands. See `docs/qa/2026-07-31-security-review.md`.

### Known limitations
- Installers are unsigned (Windows SmartScreen / macOS Gatekeeper will warn);
  no auto-update yet; default Electron app icon. See `docs/known-issues.md`.
