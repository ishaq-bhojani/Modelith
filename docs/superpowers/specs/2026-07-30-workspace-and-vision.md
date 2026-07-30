# Spec: Workspace read + vision attachments (parity sub-project #2)

**Status:** approved (content model = additive `attachments` field; deliver both,
workspace read first). Supersedes nothing.
**Roadmap items:** "projects"-like folder context; image/PDF attachments (vision).
**Depends on:** nothing new privileged for reads; vision needs a provider mapping.

Two read-only parity gaps, paired because neither writes to disk. They ship and
merge independently, workspace read first.

---

## Part A — Workspace read (ships first)

### A.1 Intent
Point the app at a folder; browse its tree; pull chosen files into the
conversation as context. **Read-only** — no writes, no execution. This is the
foundation the agentic-edit sub-project (#3) later builds on.

### A.2 Trust boundary (non-negotiable)
File reads happen **in main**, never the renderer, and are **confined to the
chosen workspace root**:

- The root is an absolute path chosen through the native directory dialog
  (`dialog.showOpenDialog({ properties: ['openDirectory'] })`). The renderer can
  never set an arbitrary root string that main trusts — main only ever reads a
  root that came from its own dialog, remembered by key.
- Every read resolves the requested path against the root with `path.resolve`
  and then verifies, via `fs.realpath`, that the resolved real path is still
  inside the root's real path. This defeats `../` traversal and symlink escape.
  A path that escapes is rejected, not clamped.
- Size cap per file (256 KB, same as the composer's text attach). Binary files
  (NUL byte in the first 8 KB, or a non-text MIME) are listed but not read as
  text; attempting to read one returns a typed "not a text file" error.
- Reads are always user-initiated (an explicit "Add to context" click). Nothing
  is read automatically on folder open — opening lists the tree only.

### A.3 IPC additions (typed, through the existing bridge)
- `workspace.pick(): Promise<string | null>` — opens the directory dialog in
  main; returns the chosen absolute root or null if cancelled. Persists it as
  `workspaceRoot` in the settings store.
- `workspace.current(): Promise<string | null>` — the remembered root.
- `workspace.tree(): Promise<TreeEntry[]>` — a flat, lazily-expandable listing
  of the current root (dirs first, `.gitignore`/`node_modules`/`.git` pruned by
  a small default ignore list). `TreeEntry = { relPath; name; kind: 'dir'|'file';
  size?; readable: boolean }`.
- `workspace.read(relPath): Promise<{ relPath; text }>` — reads one text file
  under the root, enforcing A.2. Errors are typed (`too-large`, `not-text`,
  `outside-root`, `not-found`).

All four validate `workspaceRoot` is set and confine to it. No channel accepts a
root argument from the renderer.

### A.4 Renderer
- A **Workspace panel** (a drawer, like the context inspector): "Open folder…"
  when none is set; once set, shows the root's basename and a file tree with
  checkboxes.
- "Add N files to context" reads each selected file via `workspace.read` and
  appends them to the composer draft as fenced code blocks — the *exact* format
  the existing file-attach already produces (`name:\n\n\`\`\`lang\n…\n\`\`\``),
  so this reuses one code path and needs no content-model change. Workspace read
  is therefore entirely text; it ships before the `attachments` field exists.
- Oversized/binary entries are shown disabled with a reason, never silently
  dropped.

### A.5 Tests
- **Unit (pure):** the path-confinement predicate — `isInsideRoot(root, candidate)`
  — proved against `../` traversal, absolute paths, and sibling-prefix tricks
  (`/root` vs `/root-evil`). The default-ignore matcher.
- **E2E:** with a temp workspace fixture, open folder (dialog stubbed via a test
  env root), see the tree, add a file, and verify its fenced content lands in the
  composer; a `../` read is rejected.

---

## Part B — Vision attachments (ships second)

### B.1 Content model — additive, not a migration
`ChatMessage.content` **stays a string** (canonical text). Add:

```ts
export interface Attachment {
  type: 'image'            // 'pdf' folded in later; images first
  mimeType: string         // e.g. image/png
  data: string             // base64, no data: prefix
  name?: string
}
export interface ChatMessage {
  // …existing…
  attachments?: Attachment[]
}
```

Why additive over a parts array: the fence scanner, secret scan, context budget,
session JSONL, and `MessageView` all keep operating on `.content` untouched; the
reviewed streaming core keeps mapping `content` straight through. Only the
provider request builders and the composer learn about `attachments`. Existing
sessions load unchanged (field simply absent).

### B.2 Provider mapping
Per-provider, in each provider's request builder only:
- **Anthropic:** user message becomes content blocks — `{type:'text'}` plus
  `{type:'image', source:{type:'base64', media_type, data}}` per attachment.
- **OpenAI-compat:** `content` becomes an array with `{type:'text'}` and
  `{type:'image_url', image_url:{url:'data:<mime>;base64,<data>'}}`.
- **Ollama:** maps to its `images: [base64]` field on the message.
- A provider with no vision mapping ignores attachments and the UI shows a
  quiet "this model may not read images" note (derived from a `vision?: boolean`
  capability we add to the provider summary; conservative default false).

### B.3 Composer & transcript
- Attach button also accepts images (and drag-drop/paste). Pending attachments
  render as removable thumbnails above the composer. On send they ride with the
  message; the secret scan still runs on the text only.
- Size cap per image (e.g. 5 MB) with a friendly error; base64 stored inline in
  the JSONL for v0 (documented tradeoff; a blob store is a later optimisation).
- `MessageView` renders attachment thumbnails under the user bubble.

### B.4 Tests
- **Contract suite:** extend the shared provider-contract tests — a message with
  an image attachment produces the correct per-provider wire shape (asserted
  against a captured request body), and a text-only message is byte-identical to
  today (no regression).
- **Unit:** attachment size/type validation; `vision` capability plumbing.
- **E2E:** attach an image (fixture), see the thumbnail, send; the request the
  fake provider receives carries the attachment.

---

## Definition of done
- A folder can be opened, its tree browsed, and selected files read into context,
  with reads confined to the root and proved by tests (A).
- Images attach, render as thumbnails, and reach vision-capable providers in the
  right wire shape; non-vision providers degrade quietly; text-only requests are
  unchanged (B).
- Security invariants hold: no key to the renderer, **no disk write**, reads
  confined to a dialog-chosen root, no telemetry.
