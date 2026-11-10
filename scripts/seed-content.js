#!/usr/bin/env node
/*
 * Seeds a bucket with a starter journal: the owner's username index, profile and places
 * (taken from the Phase 0 mock destinations, without media — photos arrive with uploads).
 *
 *   node scripts/seed-content.js --target local                 # Wrangler's local R2 (npm run dev)
 *   node scripts/seed-content.js --target staging               # needs `npx wrangler login`
 *   node scripts/seed-content.js --target production --yes      # production requires --yes
 *
 * Remote targets refuse to overwrite an existing places.json unless --force is given.
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { keys } from "../src/services/storage.js";
import { validatePlacesDocument, validateProfile } from "../src/utils/validation.js";

const BUCKETS = { local: "travel-memories-dev", staging: "travel-memories-staging", production: "travel-memories-production" };
const args = process.argv.slice(2);
const opt = (name) => args.includes(`--${name}`);
const target = args[args.indexOf("--target") + 1];
const OWNER = { ownerId: "dovene", username: "dovene" };

if (!BUCKETS[target] || !args.includes("--target")) {
  console.error("Usage: node scripts/seed-content.js --target local|staging|production [--yes] [--force]");
  process.exit(1);
}
if (target === "production" && !opt("yes")) {
  console.error("Refusing to seed production without --yes.");
  process.exit(1);
}

const root = new URL("..", import.meta.url).pathname;

/* Load the mock destinations the same way the browser does. */
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(root, "public/assets/js/data/mock-content.js"), "utf8"), ctx);
const mock = ctx.window.TM.mock;

const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const profile = {
  schemaVersion: 1,
  ...OWNER,
  displayName: mock.profile.displayName,
  description: { ...mock.profile.description },
  createdAt: now,
  updatedAt: now,
};
const places = {
  schemaVersion: 1,
  ownerId: OWNER.ownerId,
  places: mock.places.places.map((p) => ({
    id: p.id,
    ownerId: OWNER.ownerId,
    slug: p.slug,
    version: 1,
    name: { ...p.name },
    description: { ...p.description },
    city: p.city,
    country: { ...p.country },
    countryCode: p.countryCode,
    visitedAt: p.visitedAt,
    coverMediaId: null,
    media: [],
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  })),
};

const errors = [...validateProfile(profile), ...validatePlacesDocument(places)];
if (errors.length) {
  console.error("Seed content is invalid:", errors);
  process.exit(1);
}

const documents = [
  [keys.username(OWNER.username), { ownerId: OWNER.ownerId }],
  [keys.profile(OWNER.ownerId), profile],
  [keys.places(OWNER.ownerId), places],
];

const bucket = BUCKETS[target];
const location = target === "local" ? ["--local"] : ["--remote"];
const wrangler = (...a) => spawnSync("npx", ["wrangler", ...a], { cwd: root, encoding: "utf8" });

if (target !== "local" && !opt("force")) {
  const probe = wrangler("r2", "object", "get", `${bucket}/${keys.places(OWNER.ownerId)}`, ...location, "--pipe");
  if (probe.status === 0 && probe.stdout.trim()) {
    console.error(`${bucket} already has content for "${OWNER.ownerId}". Re-run with --force to overwrite it.`);
    process.exit(1);
  }
}

const tmp = join(root, ".seed");
rmSync(tmp, { recursive: true, force: true });
for (const [key, data] of documents) {
  const file = join(tmp, key);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  const res = wrangler("r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", "application/json; charset=utf-8", ...location);
  if (res.status !== 0) {
    console.error(`Failed to write ${key}:\n${res.stderr || res.stdout}`);
    process.exit(1);
  }
  console.log(`✓ ${bucket}/${key}`);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`Seeded ${places.places.length} destinations for @${OWNER.username} (${target}).`);
