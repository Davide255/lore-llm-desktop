import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SEMVER, buildManifest, defaultVersion, listFiles, sha256Hex, signManifest } from "./ota-lib.mjs";

const makeDist = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ota-dist-"));
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "index.html"), "<html></html>");
  writeFileSync(path.join(dir, "assets", "app-1.js"), "bundle");
  writeFileSync(path.join(dir, "assets", "copy.js"), "bundle");
  writeFileSync(path.join(dir, ".DS_Store"), "junk");
  return dir;
};

test("sha256Hex is the plain hex digest", () => {
  assert.equal(sha256Hex(Buffer.from("hello")), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

test("listFiles is sorted, relative, posix-style and skips .DS_Store", () => {
  assert.deepEqual(listFiles(makeDist()), ["assets/app-1.js", "assets/copy.js", "index.html"]);
});

test("buildManifest lists every file with its hash and size, uploading identical content once", () => {
  const dir = makeDist();
  const { manifest, uploads } = buildManifest({ distDir: dir, version: "1.0.1", runtimeVersion: "1", createdAt: "2026-10-21T00:00:00.000Z" });
  assert.equal(manifest.entry, "index.html");
  assert.equal(manifest.files.length, 3);
  assert.deepEqual(manifest.files.find((f) => f.path === "index.html"), { path: "index.html", sha256: sha256Hex(Buffer.from("<html></html>")), size: 13 });
  assert.equal(uploads.size, 2, "assets/app-1.js and assets/copy.js share one file");
});

test("buildManifest refuses a dist without index.html", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ota-empty-"));
  writeFileSync(path.join(dir, "other.html"), "x");
  assert.throws(() => buildManifest({ distDir: dir, version: "1.0.0", runtimeVersion: "1" }), /index\.html/);
});

test("signManifest verifies with the matching public key only", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const body = '{"version":"1.0.1"}';
  const sig = signManifest(body, privateKey.export({ type: "pkcs8", format: "pem" }));
  assert.equal(createVerify("RSA-SHA256").update(body).verify(publicKey, sig, "base64"), true);
  assert.equal(createVerify("RSA-SHA256").update(body + " ").verify(publicKey, sig, "base64"), false);
});

test("defaultVersion and SEMVER", () => {
  const v = defaultVersion("1.0.1", "abc1234", new Date("2026-10-21T19:27:00Z"));
  assert.equal(v, "1.0.1-ota.d20261021t1927.gabc1234");
  assert.match(v, SEMVER);
  assert.doesNotMatch("latest", SEMVER);
});
