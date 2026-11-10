#!/usr/bin/env node
/*
 * Exports a journal into a plain folder that is readable and restorable without this application.
 *
 *   npm run export -- --env staging                 # → exports/staging-<timestamp>/
 *   npm run export -- --env production --out ~/Backups
 *   npm run export -- --env local                   # while `npm run dev` is running
 *
 * Contents:
 *   content/usernames/<username>.json, content/users/<ownerId>/{profile,places}.json
 *       read directly from the R2 bucket with Wrangler (the canonical documents, byte for byte)
 *   media/users/<ownerId>/<placeId>/<file>
 *       every original and preview listed in places.json, downloaded from the site's public
 *       media URLs (exact stored bytes) and checked against the recorded size
 *   manifest.json   every file with its size, type and SHA-256 checksum
 *   README.md       what the folder contains and how to restore it
 *
 * Needs `npx wrangler login` for staging/production. Files not referenced by places.json
 * (e.g. left behind by an interrupted upload) are not exported.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { keys } from "../src/services/storage.js";
import { validatePlacesDocument, validateProfile } from "../src/utils/validation.js";

export const TARGETS = {
  local: { bucket: "travel-memories-dev", base: "http://localhost:8787", location: "--local" },
  staging: { bucket: "travel-memories-staging", base: "https://travel-memories-staging.adovene.workers.dev", location: "--remote" },
  production: { bucket: "travel-memories-production", base: "https://travel-memories.adovene.workers.dev", location: "--remote" },
};

const root = new URL("..", import.meta.url).pathname;

export function runWrangler(args) {
  return new Promise((resolvePromise) => {
    const child = spawn("npx", ["wrangler", ...args], { cwd: root });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolvePromise({ code, out }));
  });
}

/* Runs async jobs with limited parallelism. */
export async function pool(items, limit, worker) {
  const results = [];
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/* Usernames come from the configured accounts in wrangler.toml (ADMIN_USERNAME). */
function configuredUsernames() {
  const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
  return [...new Set([...toml.matchAll(/^ADMIN_USERNAME\s*=\s*"([^"]+)"/gm)].map((m) => m[1]))];
}

async function main() {
  const args = process.argv.slice(2);
  const env = args[args.indexOf("--env") + 1];
  const target = TARGETS[env];
  if (!args.includes("--env") || !target) {
    console.error("Usage: npm run export -- --env local|staging|production [--out <folder>] [--username <name>]");
    process.exit(1);
  }
  const usernames = args.includes("--username") ? [args[args.indexOf("--username") + 1]] : configuredUsernames();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  const outRoot = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : join(root, "exports");
  const out = join(outRoot, `${env}-${stamp}`);
  const files = [];

  async function getObject(key) {
    const file = join(out, key);
    mkdirSync(dirname(file), { recursive: true });
    const res = await runWrangler(["r2", "object", "get", `${target.bucket}/${key}`, target.location, "--file", file]);
    if (res.code !== 0) return null;
    const buffer = readFileSync(file);
    files.push({ path: key, size: buffer.length, contentType: "application/json", sha256: sha256(buffer) });
    return JSON.parse(buffer.toString("utf8"));
  }

  console.log(`Exporting ${env} (${target.bucket}) → ${out}`);
  const owners = [];
  for (const username of usernames) {
    const index = await getObject(keys.username(username));
    if (!index) {
      console.warn(`! No journal for @${username} in ${target.bucket}; skipped.`);
      continue;
    }
    const ownerId = index.ownerId;
    const [profile, places] = await Promise.all([getObject(keys.profile(ownerId)), getObject(keys.places(ownerId))]);
    if (!profile || !places) throw new Error(`Missing profile or places for ${ownerId}`);
    const problems = [...validateProfile(profile), ...validatePlacesDocument(places)];
    if (problems.length) console.warn(`! Content of ${ownerId} does not fully match the schema:`, problems.slice(0, 5));

    /* Every original and preview referenced by the places document. */
    const media = [];
    for (const place of places.places) {
      for (const m of place.media) {
        media.push({ place, m, variant: null, filename: m.filename, size: m.size, contentType: m.contentType });
        for (const [name, v] of Object.entries(m.variants || {}))
          media.push({ place, m, variant: name, filename: v.filename, size: v.size, contentType: v.contentType });
      }
    }

    let done = 0;
    await pool(media, 6, async (item) => {
      const url = `${target.base}/api/public/${encodeURIComponent(username)}/media/${encodeURIComponent(item.m.id)}${item.variant ? `?variant=${item.variant}` : ""}`;
      let buffer = null;
      for (let attempt = 1; attempt <= 3 && !buffer; attempt++) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          buffer = Buffer.from(await res.arrayBuffer());
        } catch (e) {
          if (attempt === 3) throw new Error(`Could not download ${item.filename}: ${e.message}`);
        }
      }
      if (buffer.length !== item.size) throw new Error(`${item.filename}: expected ${item.size} bytes, got ${buffer.length}`);
      const key = keys.media(ownerId, item.place.id, item.filename);
      const file = join(out, key);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, buffer);
      files.push({ path: key, size: buffer.length, contentType: item.contentType, sha256: sha256(buffer) });
      process.stdout.write(`\r  media ${++done}/${media.length}`);
    });
    if (media.length) process.stdout.write("\n");
    owners.push({ ownerId, username, places: places.places.length, media: media.length });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {
    format: "travel-memories-export",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    environment: env,
    bucket: target.bucket,
    owners,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    files,
  };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(out, "README.md"), readme(manifest));
  console.log(`✓ ${files.length} files, ${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MB, checksums in manifest.json`);
  console.log(`  ${out}`);
}

function readme(m) {
  return `# Travel Memories export

Exported ${m.exportedAt} from the **${m.environment}** journal (bucket \`${m.bucket}\`).
${m.owners.map((o) => `- @${o.username} (owner \`${o.ownerId}\`): ${o.places} destinations, ${o.media} media files`).join("\n")}

## What is inside

\`\`\`text
content/usernames/<username>.json         { "ownerId": "..." }: public handle → owner
content/users/<ownerId>/profile.json       the owner's profile
content/users/<ownerId>/places.json        every destination: names, descriptions, city,
                                           country, visit date, cover and ordered media list
media/users/<ownerId>/<placeId>/<file>     original photos and videos, untouched
                                           (<mediaId>.<ext>), plus smaller previews
                                           (<mediaId>.thumb-…/.display-…/.poster-….jpg)
manifest.json                              every file with size, type and SHA-256 checksum
\`\`\`

\`places.json\` links everything together: each place has an \`id\` (= its media folder name)
and a \`media\` list whose \`filename\` (and \`variants.*.filename\`) are the files in that folder,
in display order (\`position\`). The format is documented in \`schemas/places.schema.json\` and
\`schemas/profile.schema.json\` of the Travel Memories repository.

## Restoring

The folder mirrors the storage bucket exactly, so any S3-compatible tool can upload it back,
e.g. \`rclone copy . r2:<bucket>\` or \`aws s3 sync . s3://<bucket> --endpoint-url <R2 endpoint>\`
(exclude manifest.json and README.md). With the repository:

\`\`\`bash
node scripts/restore-content.js --from <this folder> --target staging
\`\`\`

Check integrity at any time with \`shasum -a 256 -c\` using the checksums in manifest.json.
`;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`\n✗ Export failed: ${e.message}`);
    process.exit(1);
  });
}
