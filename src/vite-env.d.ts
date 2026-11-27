/// <reference types="vite/client" />
import type { PlatformBridge } from './platform/PlatformBridge';

declare global {
  interface Window {
    electronAPI?: PlatformBridge;
  }
}
