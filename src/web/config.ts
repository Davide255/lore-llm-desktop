// Build-time settings of the browser build, injected by vite.config.ts from the
// same env vars the Electron main process reads (LORE_API_URL, LORE_COGNITO_*).
declare const __LORE_API_URL__: string;
declare const __LORE_COGNITO_DOMAIN__: string;
declare const __LORE_COGNITO_CLIENT_ID__: string;
declare const __LORE_REDIRECT_URI__: string;

export const API_URL = __LORE_API_URL__.replace(/\/+$/, '');
export const COGNITO_DOMAIN = __LORE_COGNITO_DOMAIN__.replace(/\/+$/, '');
export const CLIENT_ID = __LORE_COGNITO_CLIENT_ID__;

/** Where Cognito sends the browser back: the folder the app is served from, unless pinned at build time. */
export const redirectUri = () => __LORE_REDIRECT_URI__ || new URL('./', location.href).href.replace(/[?#].*$/, '');
