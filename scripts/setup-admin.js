#!/usr/bin/env node
/*
 * Sets the administrator password and the session signing key for one environment.
 *
 *   npm run setup:admin -- --env local         writes .dev.vars (git-ignored) for `npm run dev`
 *   npm run setup:admin -- --env staging       stores Wrangler secrets (needs `npx wrangler login`)
 *   npm run setup:admin -- --env production
 *   npm run setup:admin -- --env staging --generate
 *       creates a random throwaway password instead of asking for one and saves it only in
 *       the git-ignored file admin-credentials.local.txt. Replace it later by running the
 *       command again without --generate.
 *
 * The password is typed without echo, hashed here (PBKDF2-SHA256), and only the hash is stored.
 * A fresh SESSION_SECRET is generated each time, which also signs out existing sessions.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { hashPassword } from "../src/services/auth.js";

const args = process.argv.slice(2);
const target = args[args.indexOf("--env") + 1];
if (!args.includes("--env") || !["local", "staging", "production"].includes(target)) {
  console.error("Usage: npm run setup:admin -- --env local|staging|production");
  process.exit(1);
}
const generate = args.includes("--generate");
if (!generate && !process.stdin.isTTY) {
  console.error("Run this in an interactive terminal (the password is typed without echo).");
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        process.stdout.write("\n");
        process.exit(130);
      } else if (ch === "\u007f" || ch === "\b") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

let password;
if (generate) {
  password = randomBytes(15).toString("base64url"); // 20 random characters
} else {
  password = await askHidden(`New admin password for ${target}: `);
  if (password.length < 12) {
    console.error("Use at least 12 characters.");
    process.exit(1);
  }
  if ((await askHidden("Repeat the password: ")) !== password) {
    console.error("The passwords do not match.");
    process.exit(1);
  }
}

const secrets = {
  ADMIN_PASSWORD_HASH: await hashPassword(password),
  SESSION_SECRET: Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64url"),
};

const root = new URL("..", import.meta.url).pathname;

/* Throwaway passwords are written to a git-ignored file only, never printed. */
function recordGenerated() {
  if (!generate) return;
  const file = join(root, "admin-credentials.local.txt");
  appendFileSync(file, `${new Date().toISOString()}  ${target}  username: dovene  password: ${password}\n`, { mode: 0o600 });
  console.log(`✓ Throwaway password saved in admin-credentials.local.txt (git-ignored). Delete the file once you have set your own.`);
}

if (target === "local") {
  const file = join(root, ".dev.vars");
  const kept = existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim() && !/^(ADMIN_PASSWORD_HASH|SESSION_SECRET|DEV_OWNER_ID)=/.test(l))
    : [];
  writeFileSync(file, [...kept, ...Object.entries(secrets).map(([k, v]) => `${k}=${v}`)].join("\n") + "\n", { mode: 0o600 });
  recordGenerated();
  console.log("✓ Wrote .dev.vars. Restart `npm run dev`, then sign in at http://localhost:8787/admin/login as \"dovene\".");
} else {
  for (const [name, value] of Object.entries(secrets)) {
    const res = spawnSync("npx", ["wrangler", "secret", "put", name, "--env", target], { cwd: root, input: value, encoding: "utf8" });
    if (res.status !== 0) {
      console.error(`✗ Could not set ${name}:\n${res.stderr || res.stdout}`);
      console.error("Make sure you ran `npx wrangler login` and that the Worker has been deployed once.");
      process.exit(1);
    }
    console.log(`✓ ${name} set on ${target}`);
  }
  recordGenerated();
  const host = target === "production" ? "travel-memories" : "travel-memories-staging";
  console.log(`Sign in at https://${host}.adovene.workers.dev/admin/login as "dovene".`);
}
