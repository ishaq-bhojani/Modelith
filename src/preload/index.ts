import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '../shared/ipc.js'
import type { AppInfo } from '../shared/ipc.js'
import type { ChatMessage, ModelInfo, StreamEnvelope } from '../shared/types.js'

export type { StreamEnvelope } from '../shared/types.js'

export interface OpenCoderBridge {
  appInfo(): Promise<AppInfo>
  keys: {
    set(providerId: string, apiKey: string): Promise<void>
    delete(providerId: string): Promise<void>
    has(providerId: string): Promise<boolean>
  }
  providers: {
    list(): Promise<{ id: string; label: string }[]>
    models(providerId: string, baseUrl?: string): Promise<ModelInfo[]>
  }
  chat: {
    send(input: {
      sessionId: string; providerId: string; model: string; baseUrl?: string; content: string
    }): Promise<{ streamId: string }>
    abort(streamId: string): Promise<void>
    onEvent(handler: (envelope: StreamEnvelope) => void): () => void
  }
  sessions: {
    list(): Promise<{ id: string; title: string; updatedAt: number }[]>
    load(id: string): Promise<ChatMessage[]>
    create(title: string): Promise<{ id: string }>
    delete(id: string): Promise<void>
  }
}

const bridge: OpenCoderBridge = {
  appInfo: () => ipcRenderer.invoke(CHANNELS.appInfo),
  keys: {
    set: (providerId, apiKey) => ipcRenderer.invoke(CHANNELS.keySet, { providerId, apiKey }),
    delete: (providerId) => ipcRenderer.invoke(CHANNELS.keyDelete, { providerId }),
    has: (providerId) => ipcRenderer.invoke(CHANNELS.keyHas, { providerId }),
  },
  providers: {
    list: () => ipcRenderer.invoke(CHANNELS.providersList),
    models: (providerId, baseUrl) => ipcRenderer.invoke(CHANNELS.modelsList, { providerId, baseUrl }),
  },
  chat: {
    send: (input) => ipcRenderer.invoke(CHANNELS.chatSend, input),
    abort: (streamId) => ipcRenderer.invoke(CHANNELS.chatAbort, { streamId }),
    onEvent: (handler) => {
      const listener = (_e: unknown, envelope: StreamEnvelope) => handler(envelope)
      ipcRenderer.on(CHANNELS.chatEvent, listener)
      return () => { ipcRenderer.off(CHANNELS.chatEvent, listener) }
    },
  },
  sessions: {
    list: () => ipcRenderer.invoke(CHANNELS.sessionsList),
    load: (id) => ipcRenderer.invoke(CHANNELS.sessionLoad, { id }),
    create: (title) => ipcRenderer.invoke(CHANNELS.sessionCreate, { title }),
    delete: (id) => ipcRenderer.invoke(CHANNELS.sessionDelete, { id }),
  },
}

contextBridge.exposeInMainWorld('openCoder', bridge)
