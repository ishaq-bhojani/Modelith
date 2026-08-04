# Changelog

All notable changes to Modelith are recorded here. Dates are ISO (UTC).

## [Unreleased]

### Added
- In-app software updates: Modelith checks GitHub for new releases, downloads
  them in the background on Windows and Linux, and offers to restart and install.
  macOS links to the release page because unsigned builds cannot auto-install.
  Toggle in Settings → Updates.

## 0.2.0 — 2026-08-03

### Project Mode
Opening a folder now feels like a project, and the agent can work across it.

- **`search_files`** tool: the agent can search file contents across the whole
  project (confined to the workspace root), so it finds code instead of reading
  blindly. Auto-runs like the other read-only tools.
- **Trust-for-this-turn:** one approval can auto-apply the rest of a turn's gated
  actions — file edits *and* shell/MCP calls — instead of a click per file. Trust
  is per-turn only (resets every message) and every change is still checkpointed,
  so one "Revert edits" undoes the entire turn. A banner shows while it's active.
- **Persistent project tree:** a collapsible folder tree with a prominent
  "Open Folder" entry point, the open folder shown as a project header, and
  auto-restore of the last folder on launch. Per-file add-to-context is preserved.
- The agent is told (when a folder is open) that it can `list_dir`,
  `search_files`, and `read_file` to explore the project itself.

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
