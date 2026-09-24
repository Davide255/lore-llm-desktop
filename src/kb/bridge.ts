import type { LoreBridge } from './types';

declare global {
  interface Window {
    lore?: LoreBridge;
  }
}

export const lore: LoreBridge = (() => {
  if (typeof window !== 'undefined' && window.lore) return window.lore;
  throw new Error('Lore bridge not available — run the app through Electron (npm run dev).');
})();
