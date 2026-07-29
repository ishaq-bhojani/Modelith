import type { OpenCoderBridge } from '../preload/index.js'
declare global {
  interface Window { openCoder: OpenCoderBridge }
}
export {}
