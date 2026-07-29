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
} as const

export const AppInfoSchema = z.object({ version: z.string(), platform: z.string() })
export type AppInfo = z.infer<typeof AppInfoSchema>

export const KeyRefSchema = z.object({ providerId: z.string().min(1) })
export const KeySetSchema = KeyRefSchema.extend({ apiKey: z.string().min(1) })

export const SendSchema = z.object({
  sessionId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().optional(),
  content: z.string(),
})

export const AbortSchema = z.object({ streamId: z.string().min(1) })

export const SessionIdSchema = z.object({ id: z.string().min(1) })
export const SessionCreateSchema = z.object({ title: z.string() })
export const ModelsListSchema = z.object({ providerId: z.string().min(1), baseUrl: z.string().optional() })
