# Changelog

All notable changes to Modelith are recorded here. Dates are ISO (UTC).

## [Unreleased]

## 0.4.0 — 2026-08-04

### Modelith has a face
The app finally looks like itself, and Settings finally reads like a settings
screen rather than one long form.

- **A real app icon.** `electron-builder.yml` has pointed at
  `buildResources: build` since packaging was added, but that directory never
  existed — which is why every release up to v0.3.2 shipped Electron's default
  icon. `build/icon.svg` is now the single master; electron-builder generates
  the macOS `.icns`, Windows `.ico` and Linux PNG set from it.
- **The icon shows while the app is running, too.** A packaged build takes its
  taskbar icon from the executable, but in development there is no executable,
  so `npm run dev` showed Electron's logo regardless. The window now carries
  the icon directly.
- The release workflow **fails** if electron-builder falls back to the default
  icon. It only logs a warning in that case and builds happily on, which is
  exactly how the missing icon went unnoticed for four releases.

### Settings, redesigned
- **Categories behind a left rail** — Provider & key, Failover, Modes, Updates.
  The title and Done button stay put instead of scrolling away, and only the
  selected category scrolls. The rail carries icons, groups, and each row's own
  state: whether failover is off, how many modes exist, whether an update is
  waiting.
- **Every panel says what it configures**, with a title and a short
  description. Previously a 10.5px uppercase micro-label was doing the job of a
  panel heading.
- **Provider, data policy and key state are one card**, with the key state the
  most prominent thing on the panel rather than grey text between an input and
  a hint. Remove sits with the status it acts on.
- **The provider and model pickers are lists, not OS dropdowns**, reusing the
  same rows as the header model picker so the same choice looks the same in
  both places. Model rows now show their context window, and the panel shows
  the model's price where one is known.
- **A restart action in Settings → Updates**, so a ready update can be applied
  without hunting for the sidebar chip (which is dismissible).
- The auto-check control is a real toggle instead of a bare checkbox borrowed
  from the key-status styling.

### Fixed
- The download percentage no longer renders as `90.35480160960444%`.
- A test-isolation bug that made the stream-engine suite fail roughly a quarter
  of full-suite runs while passing in isolation. Emit callbacks closed over a
  module-level binding that `beforeEach` reassigns, so a still-draining stream
  delivered its events into the next test. Since `npm test` gates release
  packaging on all three runners, this could have failed a release build that
  had nothing wrong with it.

## 0.3.2 — 2026-08-04

### Fixed
- **Windows auto-update could not download.** v0.3.0 and v0.3.1 published a
  `latest.yml` pointing at `Modelith-Setup-<version>.exe`, but the installer was
  actually uploaded as `Modelith.Setup.<version>.exe` — NSIS names it with
  spaces, and GitHub rewrites spaces to dots. Every Windows client that found an
  update got a 404 when it tried to fetch it. The installer is now named without
  spaces so both agree. **Windows users on v0.3.0 or v0.3.1 must update manually
  once**; the in-app updater could not have delivered this fix to them.
  Linux and macOS were unaffected.
- The release workflow now verifies that every filename referenced by
  `latest*.yml` actually exists in the build output, so a mismatch of this kind
  fails the build instead of shipping a release that silently cannot update.

## 0.3.1 — 2026-08-04

### Fixed
- **macOS builds now cover Intel.** `macos-latest` runners are Apple Silicon, so
  releases up to and including v0.3.0 shipped an arm64 `.dmg` only — Intel Mac
  users had nothing they could install. Both architectures are now built, and
  each carries an explicit `-x64` / `-arm64` suffix so the right one is obvious.

### Internal
- Fixed a test-isolation bug that made the stream-engine suite fail ~25% of
  full-suite runs while passing in isolation: emit callbacks closed over a
  module-level binding that `beforeEach` reassigns, so a still-draining stream
  delivered its events into the next test. Since `npm test` gates release
  packaging on all three runners, this could have failed a release build that
  had nothing wrong with it.

## 0.3.0 — 2026-08-04

### Software updates
Modelith can now tell you when a new version is out, and fetch it for you.

- **Automatic checks** against GitHub Releases — shortly after launch and every
  six hours. An anonymous `GET` to a public API: no identifiers, no usage data,
  nothing about your conversations.
- **Windows and Linux** download the new version in the background and show a
  quiet chip offering to restart and install. Integrity is verified by SHA512
  against the metadata published beside the installers.
- **macOS** detects the new version and links to the release page. Builds are
  unsigned, and macOS refuses to auto-install unsigned updates.
- **Settings → Updates** shows your current version and the check status, runs a
  check on demand, and turns automatic checks off entirely. Turning them off also
  cancels an already-downloaded update instead of applying it on the next quit.
- The chip stays silent while checking or downloading, and never reports a
  failed background check — it appears only when there is something to act on.

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
