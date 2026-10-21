# Live (OTA) updates

Ships changes to the **renderer** (everything in `src/`, i.e. the built `dist/`) to installed desktop apps without a new installer. Self-hosted: static files on the same Tophost server as the Athly apps (`https://www.athly.it/ota/lore/desktop/`). Same publishing flow and key discipline as the mobile apps (`lore-llm-mobile/docs/OTA.md`); the client is `electron/ota.cjs` (Electron has no `expo-updates`, so the bundle swap is done here).

## What it can and cannot do
- **Replaces only `dist/`.** Anything in `electron/` (main process, preload, the `window.lore` API), the Electron version, `package.json` dependencies used by the main process, entitlements and the installer itself need a new build. After such a change bump `runtimeVersion` in `electron/ota.config.json`: bundles for another `runtimeVersion` are ignored, so old builds never receive a renderer that calls an API they do not have.
- The Mac App Store build is covered by the same rule as the mobile apps: Apple allows downloaded interpreted code only if it does not change the app's primary purpose (Guideline 2.5.2). Mention OTA in the App Review notes.

## How it works
1. `electron/ota.cjs` checks 10 s after start and whenever the window gets focus (at most every 15 min). Settings → Generale → "Aggiornamenti" shows the app build and the running bundle and forces a check.
2. It fetches `<baseUrl>/<channel>/manifest.json` and `manifest.sig` and verifies the **RSA-SHA256 signature** against `electron/ota-public-key.pem`, which ships inside the app. Without a valid signature nothing is downloaded.
3. The manifest lists every file of `dist/` with its sha256 and size. Each file is downloaded from `<baseUrl>/<channel>/files/<sha256>`, checked against the signed hash, and written to `userData/ota/bundles/<version>/`. A mismatch rejects the whole update. Paths with `..`, absolute paths and oversized bundles are rejected.
4. The bundle is used from the **next launch**, never while the app is running. `createWindow` then loads its `index.html` instead of the one inside the app (the preload and the main process are always the ones in the app).
5. **Rollback.** The renderer calls `window.lore.otaReady()` as soon as its UI is mounted (`src/index.tsx`). If the first load fails, the renderer process dies, or no ready signal arrives within 20 s, the window is reloaded from the app's own bundle and the version is remembered as bad. If the app is killed before the signal, the next launch drops the bundle. A bad version is never downloaded again; publish a new one.
6. **A newer installer wins.** A bundle is tied to the `app.getVersion()` it was downloaded for; after the user installs a different build the downloaded bundle is deleted. A manifest with a lower `x.y.z` than the running build is ignored, and so is anything not newer (`createdAt`) than the running or already downloaded bundle.
7. Not active in `npm run dev`, `npm start` or the browser build. `LORE_OTA_DEV=1 npm start` exercises the update path from a source checkout, `LORE_NO_OTA=1` turns it off, `LORE_OTA_CHANNEL=beta` sets the default channel.

## One-time setup
1. The signing key is `~/.lore-llm-ota/desktop/private-key.pem` (outside the repo, `chmod 600`). **Back it up** (password manager). The public key is baked into the installers: if the private key is lost, installed apps can never be updated again and a new installer with a new key is needed. To make a new pair: `openssl genrsa -out private-key.pem 2048 && openssl rsa -in private-key.pem -pubout -out electron/ota-public-key.pem`.
2. Ship an installer that contains this code (`npm run dist` / `dist:mas`). OTA reaches only builds that include it.
3. Copy `.env.example` to `.env` and fill `OTA_FTP_USER` / `OTA_FTP_PASSWORD` (same FTP account as Athly).
4. `npm run ota:publish -- --setup` uploads `ota-server/.htaccess` once. The folder `ota/lore/desktop` is created by the first upload.

## Publishing
```bash
npm run ota:publish -- --channel beta                 # build, sign → ota-dist/beta/
npm run ota:publish -- --channel beta --upload        # same, then upload
npm run ota:publish -- --upload-only --channel beta   # re-upload what is staged
npm run ota:publish -- --promote --upload             # copy the staged beta release to production
```
Options: `--version <semver>` (default `<package version>-ota.d<date>t<time>.g<sha>`), `--skip-build`.

Server layout (`electron/ota.config.json` → `baseUrl`):
```
<baseUrl>/<channel>/manifest.json   # upload LAST, no-cache
<baseUrl>/<channel>/manifest.sig    # base64 signature of the exact manifest.json bytes
<baseUrl>/<channel>/files/<sha256>  # upload FIRST, only the missing ones
```
`LORE_*` build variables (`LORE_API_URL`, …) are inlined by Vite, so publish with the same environment as the installer.

## Channels
`beta` and `production`. Installers follow `production`. **Everyone** can switch in Settings → Generale → "Versioni beta": the choice is stored in `userData/ota/state.json`, takes effect immediately (a check runs right away) and survives restarts. `LORE_OTA_CHANNEL=beta` only changes the default for a profile that has not chosen. Updates only move forward, so switching back to production keeps the beta bundle until production publishes something newer.

## Rollback of a release that runs but misbehaves
Revert the change, bump `version` in `package.json` and publish again. Devices only move forward (a different version string that is also newer by `createdAt`), so re-uploading an older manifest has no effect, and neither has re-publishing the same version.

## CI
`.github/workflows/ota.yml` publishes on push to `prepare` (beta) and `main` (production), or by hand from the Actions tab. There is no `prepare` branch yet: until it exists, only `main` and manual runs publish. Secrets: `OTA_PRIVATE_KEY` (whole PEM), `OTA_FTP_URL` (`ftp://ftp.athly.it/public_html/ota/lore/desktop`), `OTA_FTP_USER`, `OTA_FTP_PASSWORD`. Bump `version` in `package.json` to release; an already-live version is skipped. The job tests, builds, uploads, then checks that the served signature verifies with the embedded public key and every listed file exists. Restrict who can edit workflows: the key lives in GitHub too.

## Checked, and not yet checked
Unit tests cover the signature, hashes, path safety, ordering, rollback and the download flow against a fake server, and the publish script was run end to end locally. Still to check against the real server: (1) `manifest.json` and `files/*` are served untouched (no redirects, no transformation) through the nginx front, (2) an update applies after a restart in a packaged build on each OS, (3) a tampered file on the server is rejected, (4) offline start is not delayed.
