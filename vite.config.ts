import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Same env vars (and defaults) as electron/api.cjs and electron/auth.cjs.
const API_URL = process.env.LORE_API_URL || 'https://lore-llm-dev.davide-bera2021.workers.dev';
const COGNITO_DOMAIN = process.env.LORE_COGNITO_DOMAIN || 'https://eu-north-1orshbeg8h.auth.eu-north-1.amazoncognito.com';
const COGNITO_CLIENT_ID = process.env.LORE_COGNITO_CLIENT_ID || '2ij9dpmj7gacqj370obj0lehg2';

// Strict CSP for production bundles only (dev needs Vite's inline HMR preamble).
// The browser build (`--mode web`) calls the Worker and Cognito itself and shows attachments from blob: URLs.
const csp = (isWeb: boolean): Plugin => ({
  name: 'lore-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${isWeb ? 'blob:' : 'lore-asset:'} https://avatars.githubusercontent.com; font-src 'self' data:${isWeb ? `; connect-src 'self' ${new URL(API_URL).origin} ${new URL(COGNITO_DOMAIN).origin}` : ''}" />`,
    ),
});

// React Native components render through react-native-web, inside Electron or (`--mode web`) in any browser.
export default defineConfig(({ mode }) => {
  const isWeb = mode === 'web';
  return {
    base: './',
    plugins: [react(), csp(isWeb)],
    resolve: {
      alias: { 'react-native': 'react-native-web' },
      extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js', '.jsx', '.json'],
    },
    define: {
      __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
      __LORE_API_URL__: JSON.stringify(API_URL),
      __LORE_COGNITO_DOMAIN__: JSON.stringify(COGNITO_DOMAIN),
      __LORE_COGNITO_CLIENT_ID__: JSON.stringify(process.env.LORE_WEB_COGNITO_CLIENT_ID || COGNITO_CLIENT_ID),
      __LORE_REDIRECT_URI__: JSON.stringify(process.env.LORE_WEB_REDIRECT_URI ?? ''),
    },
    server: { port: 5173, strictPort: true },
    build: { outDir: isWeb ? 'dist-web' : 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  };
});
