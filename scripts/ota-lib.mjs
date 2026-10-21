// Pure helpers for scripts/publish-ota.mjs (see docs/OTA.md). They only read the files they are given.
import { createHash, createSign } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const sha256Hex = (buffer) => createHash("sha256").update(buffer).digest("hex");

// All files under `dir` as posix-style relative paths, sorted so the manifest is reproducible.
export const listFiles = (dir, rel = "") =>
  readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((entry) => {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      return entry.isDirectory() ? listFiles(dir, next) : [next];
    })
    .filter((file) => !file.endsWith(".DS_Store"))
    .sort();

/*
  Builds the manifest the app verifies and installs from a `vite build` directory.
  Every file is addressed by its sha256 (files/<sha256> on the server), so the same
  content is never uploaded twice. Returns the manifest plus remote name -> local path.
*/
export const buildManifest = ({
  distDir,
  version,
  runtimeVersion,
  entry = "index.html",
  createdAt = new Date().toISOString(),
}) => {
  const files = [];
  const uploads = new Map();
  for (const rel of listFiles(distDir)) {
    const local = path.join(distDir, rel);
    const data = readFileSync(local);
    const sha256 = sha256Hex(data);
    files.push({ path: rel, sha256, size: statSync(local).size });
    uploads.set(sha256, local);
  }
  if (!files.some((f) => f.path === entry)) throw new Error(`${entry} is not in ${distDir}`);
  return { manifest: { version, runtimeVersion, createdAt, entry, files }, uploads };
};

// RSA-SHA256 over the exact manifest bytes, base64: what electron/ota.cjs verifies.
export const signManifest = (manifestBody, privateKeyPem) =>
  createSign("RSA-SHA256").update(manifestBody).sign(privateKeyPem, "base64");

// "1.0.1" + now + sha -> "1.0.1-ota.d20261021t1927.gabc1234" (same scheme as the mobile apps).
export const defaultVersion = (pkgVersion, sha = "nogit", now = new Date()) => {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 13).toLowerCase();
  return `${pkgVersion}-ota.d${stamp}.g${sha}`;
};

export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
