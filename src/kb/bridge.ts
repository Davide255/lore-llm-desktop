import type { LoreBridge } from './types';
import { createWebBridge } from '../web/bridge';

declare global {
  interface Window {
    lore?: LoreBridge;
  }
}

/** True in a plain browser tab (GitHub Pages build), false inside Electron. */
export const isWeb = typeof window !== 'undefined' && !window.lore;

// Electron's preload provides `window.lore`; in a browser the page talks to the Worker itself.
export const lore: LoreBridge = isWeb ? createWebBridge() : window.lore!;
