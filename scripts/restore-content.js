#!/usr/bin/env node
/*
 * Restores an export folder (made by scripts/export-content.js) into a bucket.
 *
 *   npm run restore -- --from exports/staging-<timestamp> --target local
 *   npm run restore -- --from <folder> --target staging [--force]
 *   npm run restore -- --from <folder> --target production --yes [--force]
 *
 * Safety:
 *   - every file's SHA-256 is checked against manifest.json before anything is uploaded;
 *   - a target that already has content for the owner is refused unless --force;
 *   - production additionally requires --yes;
 *   - media files are uploaded first and places.json last, so the live site never
 *     references a file that is not there yet.
 * Files already in the bucket but absent from the export are left untouched.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TARGETS, pool, runWrangler, sha256 } from "./export-content.js";
import { keys } from "../src/services/storage.js";
import { validatePlacesDocument, validateProfile } from "../src/utils/validation.js";

const args = process.argv.slice(2);
const opt = (name) => args.includes(`--${name}`);
const value = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);
const from = value("from");
const targetName = value("target");
const target = TARGETS[targetName];

if (!from || !target) {
  console.error("Usage: npm run restore -- --from <export folder> --target local|staging|production [--yes] [--force]");
  process.exit(1);
}
if (targetName === "production" && !opt("yes")) {
  console.error("Refusing to restore into production without --yes.");
  process.exit(1);
}

const dir = resolve(from);
const manifestPath = join(dir, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`No manifest.json in ${dir}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.format !== "travel-memories-export" || manifest.formatVersion !== 1) {
  console.error("This folder is not a Travel Memories export (format version 1).");
  process.exit(1);
}

/* 1. Integrity and content checks — nothing is uploaded if anything is wrong. */
const problems = [];
for (const f of manifest.files) {
  if (f.path.includes("..") || f.path.startsWith("/")) problems.push(`unsafe path ${f.path}`);
  const file = join(dir, f.path);
  if (!existsSync(file)) problems.push(`missing ${f.path}`);
  else if (sha256(readFileSync(file)) !== f.sha256) problems.push(`checksum mismatch ${f.path}`);
}
for (const o of manifest.owners) {
  const profile = JSON.parse(readFileSync(join(dir, keys.profile(o.ownerId)), "utf8"));
  const places = JSON.parse(readFileSync(join(dir, keys.places(o.ownerId)), "utf8"));
  for (const e of [...validateProfile(profile), ...validatePlacesDocument(places)]) problems.push(`${o.ownerId}${e.path} ${e.message}`);
}
if (problems.length) {
  console.error(`✗ The export failed its checks; nothing was uploaded:\n- ${problems.slice(0, 20).join("\n- ")}`);
  process.exit(1);
}
console.log(`✓ ${manifest.files.length} files verified (from ${manifest.environment}, ${manifest.exportedAt})`);

/* 2. Never overwrite existing content by accident. */
if (!opt("force")) {
  for (const o of manifest.owners) {
    const probe = await runWrangler(["r2", "object", "get", `${target.bucket}/${keys.places(o.ownerId)}`, target.location, "--pipe"]);
    if (probe.code === 0 && probe.out.includes('"schemaVersion"')) {
      console.error(`✗ ${target.bucket} already has content for "${o.ownerId}". Re-run with --force to overwrite it.`);
      process.exit(1);
    }
  }
}

/* 3. Upload: media, then usernames/profile, then places.json. */
const rank = (p) => (p.startsWith("media/") ? 0 : p.endsWith("/places.json") ? 2 : 1);
const ordered = [...manifest.files].sort((a, b) => rank(a.path) - rank(b.path));
for (const stage of [0, 1, 2]) {
  const batch = ordered.filter((f) => rank(f.path) === stage);
  let done = 0;
  // Wrangler's local R2 simulator is a single local database: write to it one file at a time.
  await pool(batch, targetName === "local" ? 1 : 4, async (f) => {
    let res;
    for (let attempt = 1; attempt <= 3; attempt++) {
      res = await runWrangler([
        "r2", "object", "put", `${target.bucket}/${f.path}`, "--file", join(dir, f.path),
        "--content-type", f.contentType === "application/json" ? "application/json; charset=utf-8" : f.contentType, target.location,
      ]);
      if (res.code === 0) break;
    }
    if (res.code !== 0) throw new Error(`Upload failed for ${f.path}:\n${res.out}`);
    process.stdout.write(`\r  ${["media", "profiles", "places"][stage]} ${++done}/${batch.length}`);
  });
  if (batch.length) process.stdout.write("\n");
}
console.log(`✓ Restored into ${target.bucket} (${targetName}).`);
