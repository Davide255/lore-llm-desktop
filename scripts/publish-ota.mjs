#!/usr/bin/env node
/*
  Builds, signs and stages a live update of the renderer (see docs/OTA.md).

    node scripts/publish-ota.mjs --channel beta [--version 1.2.3] [--skip-build] [--upload]
    node scripts/publish-ota.mjs --setup                        # upload ota-server/.htaccess once
    node scripts/publish-ota.mjs --upload-only --channel beta   # re-upload what is already staged
    node scripts/publish-ota.mjs --promote [--upload]           # copy the beta release to production

  Output is written to ota-dist/<channel>/:
    files/<sha256>                       every file of dist/ (upload first, only the missing ones)
    manifest.sig                         signature of manifest.json (upload before the manifest)
    manifest.json                        what the app polls (upload last)
    history/manifest-<version>.json|.sig old manifests, for reference
*/
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEMVER, buildManifest, defaultVersion, signManifest } from "./ota-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// FTP settings live in .env (gitignored); real environment variables win.
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  /* no .env file */
}

// curl guesses the protocol from the host name when there is no scheme, so make it explicit.
if (process.env.OTA_FTP_URL) {
  const url = process.env.OTA_FTP_URL.trim();
  if (/^https?:\/\//i.test(url)) {
    console.error("\n✖ OTA_FTP_URL must be an ftp:// URL, not http(s).\n");
    process.exit(1);
  }
  process.env.OTA_FTP_URL = /^ftps?:\/\//i.test(url) ? url : `ftp://${url}`;
}

const otaConfig = JSON.parse(readFileSync(path.join(root, "electron", "ota.config.json"), "utf8"));
const outRoot = path.join(root, "ota-dist");

const fail = (message) => {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) fail(`Unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
};

const run = (cmd, cmdArgs, options = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: root, encoding: "utf8", ...options });

const channelDirOf = (channel) => path.join(outRoot, channel);

const checkChannel = (channel) => {
  if (!otaConfig.channels.includes(channel)) {
    fail(`--channel must be one of: ${otaConfig.channels.join(", ")}`);
  }
};

const privateKeyPath = () =>
  path.resolve(
    root,
    process.env.OTA_PRIVATE_KEY_PATH ||
      path.join(os.homedir(), ".lore-llm-ota", "desktop", "private-key.pem"),
  );

// Signs the exact bytes that are written, so the server must serve the file untouched.
const writeManifest = (dir, manifest) => {
  const keyPath = privateKeyPath();
  if (!existsSync(keyPath)) fail(`Private key not found at ${keyPath} (set OTA_PRIVATE_KEY_PATH).`);
  const body = JSON.stringify(manifest);
  const signature = signManifest(body, readFileSync(keyPath, "utf8"));
  writeFileSync(path.join(dir, "manifest.json"), body);
  writeFileSync(path.join(dir, "manifest.sig"), signature);
  // History keeps the signature too: it is bound to those exact bytes.
  writeFileSync(path.join(dir, "history", `manifest-${manifest.version}.json`), body);
  writeFileSync(path.join(dir, "history", `manifest-${manifest.version}.sig`), signature);
};

const promote = () => {
  const from = channelDirOf("beta");
  const to = channelDirOf("production");
  if (!existsSync(path.join(from, "manifest.json"))) fail(`No beta release staged at ${from}`);
  mkdirSync(path.join(to, "files"), { recursive: true });
  mkdirSync(path.join(to, "history"), { recursive: true });
  // Files are addressed by hash, so the manifest is the same on both channels: it is re-signed
  // (a fresh createdAt is not needed) and the beta files are copied over.
  const manifest = JSON.parse(readFileSync(path.join(from, "manifest.json"), "utf8"));
  for (const name of readdirSync(path.join(from, "files"))) {
    copyFileSync(path.join(from, "files", name), path.join(to, "files", name));
  }
  writeManifest(to, manifest);
  console.log(`✔ Promoted ${manifest.version} to production.`);
  return "production";
};

const publish = (args) => {
  const channel = args.channel;
  checkChannel(channel);

  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  let sha = "nogit";
  try {
    sha = run("git", ["rev-parse", "--short", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    /* not a git checkout */
  }
  const version = typeof args.version === "string" ? args.version : defaultVersion(pkg.version, sha);
  if (!SEMVER.test(version)) fail(`Invalid version "${version}": must be semver.`);

  const distDir = path.join(root, "dist");
  if (!args["skip-build"]) {
    console.log("› Building…");
    rmSync(distDir, { recursive: true, force: true });
    run("npm", ["run", "build"], { stdio: "inherit" });
  }
  if (!existsSync(path.join(distDir, "index.html"))) {
    fail(`${distDir}/index.html not found: run without --skip-build.`);
  }

  console.log("› Building the manifest…");
  const { manifest, uploads } = buildManifest({
    distDir,
    version,
    runtimeVersion: otaConfig.runtimeVersion,
  });

  const dir = channelDirOf(channel);
  rmSync(path.join(dir, "files"), { recursive: true, force: true });
  mkdirSync(path.join(dir, "files"), { recursive: true });
  mkdirSync(path.join(dir, "history"), { recursive: true });
  for (const [hash, local] of uploads) copyFileSync(local, path.join(dir, "files", hash));
  writeManifest(dir, manifest);

  console.log(`\n✔ Release ${version} staged in ota-dist/${channel}/ (${uploads.size} files)`);
  return channel;
};

const printUploadHelp = (channel) => {
  console.log(
    "\nUpload (files first, manifest.sig, manifest.json last):\n" +
      `  ota-dist/${channel}/  ->  ${otaConfig.baseUrl}/${channel}/\n` +
      "or set OTA_FTP_URL and pass --upload (see docs/OTA.md).",
  );
};

// FTP(S) through curl (no extra dependency). Credentials go through a curl
// config on stdin so they never show up in the process list.
const ftpPut = (localFile, remoteUrl, { user, password, tls }) => {
  const quote = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const config = [
    `user = ${quote(`${user}:${password}`)}`,
    `url = ${quote(remoteUrl)}`,
    `upload-file = ${quote(localFile)}`,
    "ftp-create-dirs",
    "fail",
    "silent",
    "show-error",
  ];
  if (tls) config.push("ssl-reqd");
  // Extra CA file for hosts that do not send their intermediate certificate (CI on Linux).
  if (process.env.OTA_FTP_CACERT) config.push(`cacert = ${quote(process.env.OTA_FTP_CACERT)}`);
  try {
    execFileSync("curl", ["--config", "-"], {
      cwd: root,
      input: config.join("\n") + "\n",
      stdio: ["pipe", "inherit", "inherit"],
    });
  } catch {
    fail(`FTP upload failed for ${remoteUrl} (see the curl error above).`);
  }
};

const ftpOptions = () => {
  const user = process.env.OTA_FTP_USER;
  const password = process.env.OTA_FTP_PASSWORD;
  if (!process.env.OTA_FTP_URL) fail("Upload needs OTA_FTP_URL (+ user/password) in .env.");
  if (!user || !password) fail("FTP upload needs OTA_FTP_USER and OTA_FTP_PASSWORD.");
  // OTA_FTP_TLS=0 only if the host really has no FTPS (credentials then travel in clear).
  return { user, password, tls: process.env.OTA_FTP_TLS !== "0" };
};

// Files are content-hashed: an HTTP 200 on the public URL means it is already there.
const alreadyOnline = async (url) => {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15000) });
    return res.status === 200;
  } catch {
    return false;
  }
};

const upload = async (channel) => {
  const opts = ftpOptions();
  const base = process.env.OTA_FTP_URL.replace(/\/+$/, "");
  const dir = channelDirOf(channel);
  console.log(`› Uploading to ${base}/${channel}/ (FTP${opts.tls ? "S" : ", NO TLS"})…`);

  // Files first, manifest last: the app never sees a manifest without its files.
  const filesDir = path.join(dir, "files");
  let skipped = 0;
  for (const file of readdirSync(filesDir)) {
    if (await alreadyOnline(`${otaConfig.baseUrl}/${channel}/files/${file}`)) {
      skipped++;
      continue;
    }
    console.log(`  ${file.slice(0, 12)}…`);
    ftpPut(path.join(filesDir, file), `${base}/${channel}/files/${file}`, opts);
  }
  if (skipped) console.log(`  (${skipped} files already online)`);
  console.log("  manifest.sig");
  ftpPut(path.join(dir, "manifest.sig"), `${base}/${channel}/manifest.sig`, opts);
  console.log("  manifest.json");
  ftpPut(path.join(dir, "manifest.json"), `${base}/${channel}/manifest.json`, opts);
};

const args = parseArgs(process.argv.slice(2));

if (args.setup) {
  const opts = ftpOptions();
  const base = process.env.OTA_FTP_URL.replace(/\/+$/, "");
  ftpPut(path.join(root, "ota-server", ".htaccess"), `${base}/.htaccess`, opts);
  console.log("✔ Server folder ready.");
  process.exit(0);
}

if (args["upload-only"]) {
  checkChannel(args.channel);
  if (!existsSync(path.join(channelDirOf(args.channel), "manifest.json"))) {
    fail(`Nothing staged in ota-dist/${args.channel}/.`);
  }
  await upload(args.channel);
  console.log("✔ Uploaded.");
  process.exit(0);
}

const channel = args.promote ? promote() : publish(args);
if (args.upload) {
  await upload(channel);
  console.log("✔ Uploaded.");
} else printUploadHelp(channel);
