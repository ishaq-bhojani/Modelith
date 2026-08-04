# Projects — design

Date: 2026-08-04
Status: approved (design), pending implementation plan

## Problem

Modelith knows about exactly one folder. `workspaceRoot` is a single string in
`settings.json`; opening a folder replaces whatever was open before, and the
sidebar lists every session ever created in one flat list regardless of what
they were about.

Anyone using the app for more than one codebase is therefore doing bookkeeping
in their head: re-opening the right folder when they switch, and scanning a
single undifferentiated list for the conversation that belonged to it. This is
the largest structural gap between Modelith and comparable desktop agents — and
it is the one that makes an otherwise capable app feel small.

## Goals

1. Several projects exist at once, each with its own folder.
2. Sessions are grouped by the project they belong to.
3. Switching projects re-points the workspace without re-picking a folder.
4. Nothing that exists today is lost or requires the user to reorganise it.

## Non-goals

- Multiple roots per project.
- Per-project provider, model or modes. Global settings stay global.
- Cross-project search.
- Drag-and-drop reordering.
- Any relaxation of workspace confinement. The agent still sees exactly one
  root at a time.

---

## Decisions

| Decision | Choice | Why |
|---|---|---|
| What a project is | A folder, with an editable display name | Matches what the app already does (pick a folder) and adds no create-and-name ceremony. The editable name keeps the sidebar readable when two checkouts share a basename. |
| Existing sessions | Stay in an **Unfiled** group, moveable | Non-destructive and honest — it does not guess which project a months-old chat belonged to. |
| Active project | All projects listed, exactly one active | Gives the at-a-glance sidebar without touching the confinement model. |
| Removing a project | Forget it; its sessions become Unfiled | "Close this project" is what a user means. Nothing on disk is touched, no conversation is deleted. |

## Data model

A new `ProjectStore` beside `SessionStore`, using the same atomic
temp-file-plus-rename write, at `<userData>/projects.json`:

```ts
interface ProjectMeta {
  id: string          // randomUUID
  name: string        // defaults to basename(root), editable
  root: string        // absolute path
  createdAt: number
  lastOpenedAt: number
}
```

`SessionMeta` gains exactly one optional field:

```ts
  /** The project this session belongs to. Absent means Unfiled. */
  projectId?: string
```

**There is no session migration.** Existing `index.json` entries are already
correct — they simply lack the field, which is what Unfiled means.

The one real migration is the existing `workspaceRoot` setting: on first launch
after this ships, if it is set and no project has that root, create a project
from it and make it active. That turns a folder the user genuinely had open
into a project; it files no sessions.

## Where the agent's root comes from

This is the load-bearing decision of the spec.

The obvious model — "the agent's root is the active project's root" — is
wrong. If the active project changes while a turn is streaming, an in-flight
tool call resolves against the **new** root: the user approves a write in
project A and it lands in project B. That is a confinement violation wearing a
UI convenience as a disguise.

Instead:

> **The agent's root is a function of the session, resolved at turn start.**
> session → `projectId` → `root`.

"Active project" stops being an input to file access. It still does two jobs —
it decides which group the sidebar highlights and which tree the workspace
panel shows, and it decides which project a **newly created** session belongs
to — but neither of those can retarget a turn that is already running. The
hazard disappears rather than being guarded against, and no "don't switch while
streaming" rule is needed.

Consequences:

- `Workspace` stops reading `workspaceRoot` from settings and instead resolves
  a root for a given session.
- A session with no project has **no root**. Workspace tools are unavailable to
  it, exactly as they are today before a folder is picked — not an error.
- A session whose `projectId` points at a removed project also resolves to no
  root. It must never silently fall back to some other project's folder.

`isInsideRoot`, the realpath resolution and every confinement test are
unchanged. Only where the root string comes from changes.

## Sidebar

Projects are ordered **most recently opened first** — that is what
`lastOpenedAt` is for, and it keeps whatever you are actually working on at the
top without any manual ordering. Sessions within a project keep their existing
sort (pinned first, then by `updatedAt`).

Each project is a collapsible group with its sessions beneath it, the active
one marked with the same `aria-current` accent bar `.session-row` already uses
(`theme.css`), so "selected" keeps meaning one thing. A `+` in the sidebar
header opens the folder dialog. **Unfiled** sits at the bottom and is not
rendered at all when empty, so a fresh install never sees it.

Row menus reuse the existing `.row-actions` pattern (`Sidebar.tsx`):

- **Session** → gains "Move to project…"
- **Project** → Rename, Open folder, Remove

"New chat" creates its session in the active project.

## IPC

Following the existing `settings:get` naming:

| Key | Channel | Purpose |
|---|---|---|
| `projectsList` | `projects:list` | all projects, and which is active |
| `projectCreate` | `projects:create` | folder dialog → create-or-reuse → set active |
| `projectRename` | `projects:rename` | display name only |
| `projectRemove` | `projects:remove` | forget it; its sessions become Unfiled |
| `projectSetActive` | `projects:set-active` | UI selection |
| `sessionSetProject` | `sessions:set-project` | move one session |

`projects:rename` deliberately cannot change `root`, and `projects:create`
takes no path — the folder comes from the native dialog in main. **The renderer
must never supply a path that becomes an agent's confinement boundary**, for
the same reason it cannot supply a provider `baseUrl` or an update feed URL.

Adding these means touching `shared/ipc.ts` (zod schemas) → `main/ipc/handlers.ts`
→ `preload` → renderer store together, per `AGENTS.md`.

## Error handling

| Case | Behaviour |
|---|---|
| Project's folder no longer exists on disk | The project still lists; selecting it shows an empty tree with an explanatory line. Not removed automatically — a folder can be on an unmounted drive. |
| `projectId` references a removed project | Session resolves to no root and renders under Unfiled. Never falls back to another project. |
| `projects.json` missing | Treated as no projects, exactly as the settings store treats a missing file. |
| `projects.json` corrupt | Fail loudly rather than silently discarding the user's project list — unlike preferences, this is user data whose loss is visible and confusing. |
| Folder picked that a project already uses | Reuse and activate the existing project rather than creating a duplicate. |

## Testing

**Unit:**

- `ProjectStore`: create, rename, remove, and that concurrent writes do not
  lose each other — mirroring the existing `session-store` and
  `settings-store` tests.
- The `workspaceRoot` → project migration, **including** the case where a
  matching project already exists (must not duplicate).
- Root resolution from a session: with a project, with no project, and
  **with a `projectId` pointing at a removed project** — the last must resolve
  to no root rather than throwing or falling back.
- Removing a project leaves its sessions intact and Unfiled.

**E2E:**

- Create two projects; confirm each session groups under the right one.
- Switching the active project re-points the workspace tree.
- A pre-existing session with no `projectId` appears under Unfiled.

The removed-project test matters most: that state is deliberately created by
the non-destructive Remove, so it is a supported state and must be exercised
rather than assumed.

## Risks

- **The `Workspace` root change touches the confinement path.** Nothing about
  `isInsideRoot` changes, but the call sites that obtain a root all move. The
  existing confinement e2e tests (`workspace.spec.ts`,
  `project-mode.spec.ts`) are the guard and must pass untouched.
- **`SessionMeta` is persisted user data.** Adding an optional field is
  backward-compatible in both directions; nothing may make it required.
- **The sidebar is already the most complex renderer component.** Grouping adds
  nesting to a file that is close to needing a split; if it becomes unwieldy
  while implementing, extracting the project group into its own component is in
  scope.
