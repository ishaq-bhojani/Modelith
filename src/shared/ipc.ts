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
} as const

export const AppInfoSchema = z.object({ version: z.string(), platform: z.string() })
export type AppInfo = z.infer<typeof AppInfoSchema>

export const KeyRefSchema = z.object({ providerId: z.string().min(1) })
export const KeySetSchema = KeyRefSchema.extend({ apiKey: z.string().min(1) })

export const SendSchema = z.object({
  sessionId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  content: z.string(),
  // Optional system prompt (from a Mode); prepended by the engine before
  // budgeting. Optional temperature flows through to the provider request.
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
})

export const AbortSchema = z.object({ streamId: z.string().min(1) })

export const SessionIdSchema = z.object({ id: z.string().min(1) })
export const SessionCreateSchema = z.object({ title: z.string() })
export const SessionRenameSchema = z.object({ id: z.string().min(1), title: z.string().min(1) })
// Intentionally no renderer-supplied `baseUrl` field here (or on SendSchema):
// the renderer cannot read an API key, but a renderer-controlled base URL
// would let it redirect where main sends that key. Providers use their own
// `defaultBaseUrl` (see src/main/providers/types.ts's ProviderConfig, which
// keeps a main-side-only `baseUrl` for the contract suite and future
// main-side configuration).
export const ModelsListSchema = z.object({ providerId: z.string().min(1) })
