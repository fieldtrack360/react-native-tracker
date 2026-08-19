#!/usr/bin/env node
/*
 * postinstall — fetch the pinned Tracker iOS XCFrameworks into ios/Frameworks and verify a
 * recorded SHA-256 per framework. ios/Frameworks ships EMPTY and is filled here,
 * on the consumer's machine, so a second staler copy of the SDK never rides inside a release.
 *
 * Checksums are NOT optional. The upstream tags are MUTABLE and have been republished in
 * place more than once — same version number, different bytes. A tag-only pin would rebuild
 * against different code with nothing to detect it. This script fails loudly and names BOTH
 * digests on mismatch.
 *
 * Known incident, 2026-08-19: tag `1.0.0` moved from commit ed150b3 to 3e505d2 (unrelated
 * histories — the repo was force-pushed, so the two commits share no merge base despite an
 * identical message and author date). This guard caught it on postinstall. Investigated: four of
 * the five XCFrameworks were byte-identical in both Mach-O binaries and .swiftinterface, differing
 * only in _CodeSignature (a re-sign) and in the ORDER of the Info.plist AvailableLibraries array
 * (non-deterministic `xcodebuild -create-xcframework` output). TrackerSync genuinely changed, with
 * exactly one additive public delta: SyncConfig gained Codable. Benign, so the pin was moved.
 * Superseded digests are in the git history of package.json.
 *
 * Source resolution, in order:
 *   1. $TRACKER_IOS_DIST_LOCAL — a local dist checkout (dir containing Artifacts/).
 *   2. a sibling ../tracker-ios or ../../tracker-ios checkout (dev convenience).
 *   3. download the tag tarball from the dist repo (the published-consumer path).
 * Set $TRACKER_IOS_FORCE_DOWNLOAD=1 to skip 1–2 and always download.
 *
 * Modes:
 *   (default)  verify each framework against package.json and copy into ios/Frameworks.
 *   --record   recompute digests from the resolved frameworks and write them into package.json
 *              (run on an SDK bump, then commit the two-line change).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PKG_ROOT = path.resolve(__dirname, '..');
const PKG_JSON = path.join(PKG_ROOT, 'package.json');
const DEST = path.join(PKG_ROOT, 'ios', 'Frameworks');
const FRAMEWORKS = [
  'TrackerGeo.xcframework',
  'TrackerCore.xcframework',
  'TrackerMaps.xcframework',
  'TrackerSnap.xcframework',
  'TrackerSync.xcframework',
];
// The SDK repo (public). It carries the XCFrameworks in-tree under Artifacts/ — there is no
// separate dist repo and no published checksum/zip URL, so the digest pin below is the only
// defence against a force-published tag. Overridable for a fork/mirror via $TRACKER_IOS_DIST_REPO.
const DIST_REPO =
  process.env.TRACKER_IOS_DIST_REPO || 'fieldtrack360/tracker-ios';

function log(msg) {
  process.stdout.write(`[tracker:fetch-ios] ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`[tracker:fetch-ios] ERROR: ${msg}\n`);
  process.exit(1);
}

// Deterministic digest of an .xcframework — the SAME function records and verifies, so the
// exact byte format never has to be reproduced across tools. Manifest = for every regular file
// under the framework, sorted by POSIX-relative path: <relpath>\0<sha256(file)>\0; then sha256
// of that manifest.
function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function listFilesRel(root) {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile())
        out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  })(root);
  return out.sort();
}
function digestXcframework(dir) {
  const h = crypto.createHash('sha256');
  for (const rel of listFilesRel(dir)) {
    h.update(rel, 'utf8');
    h.update('\0');
    h.update(sha256File(path.join(dir, rel)));
    h.update('\0');
  }
  return h.digest('hex');
}

function readPkg() {
  return JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'));
}

// Resolve a directory that contains Artifacts/<name>.xcframework for all five frameworks.
function resolveArtifactsDir(tag) {
  const force = process.env.TRACKER_IOS_FORCE_DOWNLOAD === '1';
  const candidates = [];
  if (!force) {
    if (process.env.TRACKER_IOS_DIST_LOCAL)
      candidates.push(process.env.TRACKER_IOS_DIST_LOCAL);
    candidates.push(path.resolve(PKG_ROOT, '..', 'tracker-ios'));
    candidates.push(path.resolve(PKG_ROOT, '..', '..', 'tracker-ios'));
  }
  for (const c of candidates) {
    const art = path.join(c, 'Artifacts');
    if (FRAMEWORKS.every((f) => fs.existsSync(path.join(art, f)))) {
      log(`using local dist checkout: ${art}`);
      return art;
    }
  }
  return downloadTarball(tag);
}

function downloadTarball(tag) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-ios-'));
  const tarPath = path.join(tmp, 'dist.tar.gz');
  const url = `https://codeload.github.com/${DIST_REPO}/tar.gz/refs/tags/${tag}`;
  log(`downloading ${url}`);
  // curl is present on macOS/Linux CI; -f fails on HTTP error, -L follows redirects.
  execFileSync('curl', ['-fsSL', '-o', tarPath, url], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  execFileSync('tar', ['-xzf', tarPath, '-C', tmp], { stdio: 'inherit' });
  const top = fs
    .readdirSync(tmp)
    .map((n) => path.join(tmp, n))
    .find(
      (p) =>
        fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'Artifacts'))
    );
  if (!top)
    fail(
      `downloaded tarball has no Artifacts/ directory (repo ${DIST_REPO}, tag ${tag})`
    );
  return path.join(top, 'Artifacts');
}

function record(pkg, artifactsDir) {
  const checksums = {};
  for (const f of FRAMEWORKS) {
    const dir = path.join(artifactsDir, f);
    if (!fs.existsSync(dir)) fail(`missing ${f} in ${artifactsDir}`);
    checksums[f] = digestXcframework(dir);
    log(`recorded ${f} ${checksums[f]}`);
  }
  pkg.tracker.ios.checksums = checksums;
  pkg.tracker.ios.checksumRule =
    'per XCFramework: sha256 over the manifest of every regular file under the framework, ' +
    'sorted by POSIX-relative path, each entry <relpath>\\0<sha256(file)>\\0 ' +
    '(see scripts/fetch-ios-frameworks.js digestXcframework)';
  fs.writeFileSync(PKG_JSON, JSON.stringify(pkg, null, 2) + '\n');
  log('wrote digests to package.json');
}

function verifyAndCopy(pkg, artifactsDir) {
  const expected =
    (pkg.tracker && pkg.tracker.ios && pkg.tracker.ios.checksums) || {};
  fs.mkdirSync(DEST, { recursive: true });
  for (const f of FRAMEWORKS) {
    const src = path.join(artifactsDir, f);
    if (!fs.existsSync(src)) fail(`missing ${f} in ${artifactsDir}`);
    const want = expected[f];
    if (!want)
      fail(
        `no recorded checksum for ${f} in package.json (run with --record on an SDK bump)`
      );
    const got = digestXcframework(src);
    if (got !== want) {
      fail(
        `checksum mismatch for ${f} — the pinned tag's bytes changed under it.\n` +
          `  expected: ${want}\n` +
          `  actual:   ${got}\n` +
          `  Purge caches and re-pin deliberately; do not proceed against unknown bytes.`
      );
    }
    const dst = path.join(DEST, f);
    fs.rmSync(dst, { recursive: true, force: true });
    // cp -R preserves the framework bundle structure exactly.
    execFileSync('cp', ['-R', src, dst], { stdio: 'inherit' });
    log(`verified + installed ${f}`);
  }
}

function main() {
  const pkg = readPkg();
  const ios = (pkg.tracker && pkg.tracker.ios) || {};
  const tag = ios.tag;
  if (!tag) fail('package.json tracker.ios.tag is not set');

  const recordMode = process.argv.includes('--record');
  const artifactsDir = resolveArtifactsDir(tag);

  if (recordMode) {
    record(pkg, artifactsDir);
  } else {
    verifyAndCopy(pkg, artifactsDir);
    log(
      `done — ${FRAMEWORKS.length} frameworks in ios/Frameworks (tag ${tag})`
    );
  }
}

try {
  main();
} catch (err) {
  fail(err && err.message ? err.message : String(err));
}
