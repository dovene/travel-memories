#!/usr/bin/env node
/*
 * Static checks run in CI before tests and deployment:
 *  1. Every JavaScript file parses.
 *  2. English and French translation files define exactly the same keys.
 *  3. wrangler.toml keeps staging and production isolated (distinct Worker names and buckets).
 *  4. No obvious secrets are committed in frontend files.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const root = new URL("..", import.meta.url).pathname;
const failures = [];
const fail = (msg) => failures.push(msg);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(root);

// 1. Syntax
for (const f of files.filter((f) => extname(f) === ".js")) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    fail(`Syntax error in ${relative(root, f)}:\n${e.stderr}`);
  }
}

// 2. Translation parity
function loadLocale(lang) {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(join(root, `public/assets/js/i18n/${lang}.js`), "utf8"), ctx);
  return ctx.window.TM.locales[lang];
}
const en = loadLocale("en");
const fr = loadLocale("fr");
for (const k of Object.keys(en)) if (!(k in fr)) fail(`Missing French translation: ${k}`);
for (const k of Object.keys(fr)) if (!(k in en)) fail(`French key not in English: ${k}`);
for (const [lang, dict] of [["en", en], ["fr", fr]])
  for (const [k, v] of Object.entries(dict)) if (!String(v).trim()) fail(`Empty ${lang} translation: ${k}`);

// 3. Environment isolation
const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
/* All lines belonging to [env.<name>], [env.<name>.*] and [[env.<name>.*]] tables. */
function section(name) {
  let inside = false;
  let found = false;
  const out = [];
  for (const line of toml.split("\n")) {
    const header = line.match(/^\s*\[\[?([^\]]+)\]\]?/);
    if (header) {
      const table = header[1].trim();
      inside = table === `env.${name}` || table.startsWith(`env.${name}.`);
      if (inside) found = true;
    }
    if (inside) out.push(line);
  }
  return found ? out.join("\n") : null;
}
const envs = {};
for (const name of ["staging", "production"]) {
  const s = section(name);
  if (!s) {
    fail(`wrangler.toml is missing [env.${name}]`);
    continue;
  }
  envs[name] = {
    worker: (s.match(/^name\s*=\s*"([^"]+)"/m) || [])[1],
    bucket: (s.match(/bucket_name\s*=\s*"([^"]+)"/) || [])[1],
    environment: (s.match(/ENVIRONMENT\s*=\s*"([^"]+)"/) || [])[1],
  };
  for (const [key, val] of Object.entries(envs[name])) if (!val) fail(`[env.${name}] has no ${key}`);
  if (envs[name].environment && envs[name].environment !== name) fail(`[env.${name}] sets ENVIRONMENT="${envs[name].environment}"`);
}
if (envs.staging && envs.production) {
  if (envs.staging.worker === envs.production.worker) fail("Staging and production share a Worker name");
  if (envs.staging.bucket === envs.production.bucket) fail("Staging and production share an R2 bucket");
}
// A plain `wrangler deploy` (no --env) uses the top-level config; it must not target a deployed Worker.
const topLevel = toml.split(/^\s*\[/m)[0];
const topName = (topLevel.match(/^name\s*=\s*"([^"]+)"/m) || [])[1];
const topBucket = (toml.match(/^\[\[r2_buckets\]\][^[]*bucket_name\s*=\s*"([^"]+)"/m) || [])[1];
for (const name of ["staging", "production"]) {
  if (!envs[name]) continue;
  if (topName && topName === envs[name].worker) fail(`Top-level Worker name "${topName}" collides with [env.${name}]`);
  if (topBucket && topBucket === envs[name].bucket) fail(`Top-level R2 bucket "${topBucket}" collides with [env.${name}]`);
}

// 4. Secrets in frontend code
const secretPatterns = [/api[_-]?token\s*[:=]\s*["'][^"']{12,}/i, /password\s*[:=]\s*["'][^"']+["']/i, /secret\s*[:=]\s*["'][^"']{8,}/i, /BEGIN [A-Z ]*PRIVATE KEY/];
for (const f of files.filter((f) => f.includes("/public/") && /\.(js|html)$/.test(f))) {
  const text = readFileSync(f, "utf8");
  for (const re of secretPatterns) if (re.test(text)) fail(`Possible secret in ${relative(root, f)} (${re})`);
}

// 5. The Workers runtime rejects non-handler exports from the entry module.
const entry = await import(join(root, "src/index.js"));
const extra = Object.keys(entry).filter((k) => k !== "default");
if (extra.length) fail(`src/index.js may only have a default export (found: ${extra.join(", ")})`);

if (failures.length) {
  console.error(`✗ ${failures.length} check(s) failed:\n- ` + failures.join("\n- "));
  process.exit(1);
}
console.log(`✓ Static checks passed (${files.filter((f) => extname(f) === ".js").length} JS files, ${Object.keys(en).length} translation keys, staging/production isolated)`);
