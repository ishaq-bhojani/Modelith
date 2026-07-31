import type { ModelithBridge } from '../preload/index.js'
declare global {
  interface Window { modelith: ModelithBridge }
}
export {}
