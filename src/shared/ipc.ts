import { z } from 'zod'

export const CHANNELS = {
  appInfo: 'app:info',
  keySet: 'secrets:set',
  keyDelete: 'secrets:delete',
  keyHas: 'secrets:has',
  providersList: 'providers:list',
  modelsList: 'providers:models',
  chatSend: 'chat:send',
  chatAbort: 'chat:abort',
  chatEvent: 'chat:event',
  sessionsList: 'sessions:list',
  sessionLoad: 'sessions:load',
  sessionCreate: 'sessions:create',
  sessionDelete: 'sessions:delete',
  sessionRename: 'sessions:rename',
  sessionSetPinned: 'sessions:set-pinned',
  sessionSetArchived: 'sessions:set-archived',
  sessionSetTags: 'sessions:set-tags',
  sessionBranch: 'sessions:branch',
  sessionTruncateFrom: 'sessions:truncate-from',
  sessionEditMessage: 'sessions:edit-message',
  chatPreview: 'chat:preview',
  windowMinimize: 'window:minimize',
  windowMaximizeToggle: 'window:maximize-toggle',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximizedChanged: 'window:maximized-changed',
  windowOpenChatsFolder: 'window:open-chats-folder',
  windowAbout: 'window:about',
  appQuit: 'app:quit',
  // Main → renderer: a keyboard accelerator fired; the renderer runs the same
  // action its ⋯ menu / palette would, so there is one code path per action.
  menuNewChat: 'menu:new-chat',
  menuSettings: 'menu:settings',
  menuCommandPalette: 'menu:command-palette',
  menuSearch: 'menu:search',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  updatesGet: 'updates:get',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',
  updatesSetEnabled: 'updates:set-enabled',
  updatesChanged: 'updates:changed',
  workspacePick: 'workspace:pick',
  workspaceCurrent: 'workspace:current',
  workspaceTree: 'workspace:tree',
  workspaceRead: 'workspace:read',
  workspaceRevert: 'workspace:revert',
  chatToolDecision: 'chat:tool-decision',
  mcpList: 'mcp:list',
  mcpAdd: 'mcp:add',
  mcpRemove: 'mcp:remove',
  mcpSetEnabled: 'mcp:set-enabled',
  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  chatRace: 'chat:race',
  chatChooseWinner: 'chat:choose-winner',
} as const

export const AppInfoSchema = z.object({ version: z.string(), platform: z.string() })
export type AppInfo = z.infer<typeof AppInfoSchema>

export const KeyRefSchema = z.object({ providerId: z.string().min(1) })
export const KeySetSchema = KeyRefSchema.extend({ apiKey: z.string().min(1) })

export const FallbackSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
})

export const AttachmentSchema = z.object({
  type: z.literal('image'),
  mimeType: z.string().min(1),
  data: z.string().min(1),
  name: z.string().optional(),
})

export const SendSchema = z.object({
  sessionId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  content: z.string(),
  // Image attachments sent with this turn (spec §B). Optional and additive.
  attachments: z.array(AttachmentSchema).optional(),
  // Opt-in to agentic edit tools for this turn (agentic-edits spec §3).
  agent: z.boolean().optional(),
  // Optional system prompt (from a Mode); prepended by the engine before
  // budgeting. Optional temperature flows through to the provider request.
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  // Ordered failover targets, tried in turn if the primary fails with a
  // retryable error before any text has streamed.
  fallbacks: z.array(FallbackSchema).optional(),
})

export const SettingsPatchSchema = z.record(z.string(), z.unknown())

export const AbortSchema = z.object({ streamId: z.string().min(1) })

export const SessionIdSchema = z.object({ id: z.string().min(1) })
export const SessionCreateSchema = z.object({ title: z.string() })
export const SessionRenameSchema = z.object({ id: z.string().min(1), title: z.string().min(1) })
export const SessionSetPinnedSchema = z.object({ id: z.string().min(1), pinned: z.boolean() })
export const SessionSetArchivedSchema = z.object({ id: z.string().min(1), archived: z.boolean() })
export const SessionSetTagsSchema = z.object({ id: z.string().min(1), tags: z.array(z.string()) })
export const SessionBranchSchema = z.object({
  sourceId: z.string().min(1),
  uptoId: z.string().min(1),
  title: z.string(),
})
export const SessionMessageRefSchema = z.object({ id: z.string().min(1), messageId: z.string().min(1) })
export const SessionEditMessageSchema = SessionMessageRefSchema.extend({ content: z.string() })
// Intentionally no renderer-supplied `baseUrl` field here (or on SendSchema):
// the renderer cannot read an API key, but a renderer-controlled base URL
// would let it redirect where main sends that key. Providers use their own
// `defaultBaseUrl` (see src/main/providers/types.ts's ProviderConfig, which
// keeps a main-side-only `baseUrl` for the contract suite and future
// main-side configuration).
export const ModelsListSchema = z.object({ providerId: z.string().min(1) })

// Workspace read (spec §A.3). Only a root-relative path crosses from the
// renderer; the root itself is chosen and held by main and is never accepted as
// an argument, so the renderer cannot point main at an arbitrary directory.
export const WorkspaceReadSchema = z.object({ relPath: z.string().min(1) })
export const WorkspaceRevertSchema = z.object({ turnId: z.string().min(1) })

// A diff-gate decision from the renderer (agentic-edits spec §4). `content` is
// present only for an edited-then-accepted write.
export const ToolDecisionSchema = z.object({
  callId: z.string().min(1),
  action: z.enum(['accept', 'reject', 'edited']),
  content: z.string().optional(),
  trustTurn: z.boolean().optional(),
})

// MCP server management (mcp-client spec §2). The renderer supplies the config;
// main spawns and manages the process.
export const McpAddSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
})
export const McpIdSchema = z.object({ id: z.string().min(1) })
export const McpSetEnabledSchema = z.object({ id: z.string().min(1), enabled: z.boolean() })

export const GitDiffSchema = z.object({ path: z.string().optional() })

// Model Race (model-race spec §2–3): a prompt sent to 2–4 targets at once.
export const RaceSchema = z.object({
  sessionId: z.string().min(1),
  content: z.string().min(1),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  entries: z.array(FallbackSchema).min(2).max(4),
})
export const ChooseWinnerSchema = z.object({ raceId: z.string().min(1), columnId: z.string().min(1) })

// Software updates (auto-update spec). Note there is deliberately no field here
// for a feed URL, owner, or repo: those are constants in
// src/main/updater/policy.ts. A renderer-supplied feed would let compromised UI
// point the updater at an attacker's binary — the same reasoning that keeps
// `baseUrl` off SendSchema above.
export const UpdateStatusSchema = z.enum([
  'idle', 'checking', 'available', 'downloading', 'ready', 'error',
])

export const UpdateStateSchema = z.object({
  status: UpdateStatusSchema,
  canAutoInstall: z.boolean(),
  currentVersion: z.string(),
  latestVersion: z.string().optional(),
  percent: z.number().min(0).max(100).optional(),
  releaseUrl: z.string().optional(),
  message: z.string().optional(),
  enabled: z.boolean(),
  lastCheckedAt: z.number().optional(),
  manualCheck: z.boolean(),
})

export const UpdatesSetEnabledSchema = z.object({ enabled: z.boolean() })
