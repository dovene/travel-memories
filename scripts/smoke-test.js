#!/usr/bin/env node
/*
 * Post-deploy smoke test. Confirms the deployed Worker:
 *  - serves the homepage,
 *  - answers /api/health with the expected environment name (proves staging/production
 *    are not crossed), and
 *  - can reach its R2 bucket.
 *
 * Usage: BASE_URL=https://travel-memories-staging.<sub>.workers.dev EXPECTED_ENV=staging node scripts/smoke-test.js
 */
const base = (process.env.BASE_URL || "").replace(/\/$/, "");
const expected = process.env.EXPECTED_ENV;

if (!base) {
  console.error("BASE_URL is required");
  process.exit(1);
}

async function retry(fn, attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 2000 * i)); // new deployments can take a moment to propagate
    }
  }
}

await retry(async () => {
  const home = await fetch(base + "/");
  if (!home.ok) throw new Error(`Homepage returned ${home.status}`);
  const html = await home.text();
  if (!html.includes("Travel Memories")) throw new Error("Homepage does not look like Travel Memories");

  const res = await fetch(base + "/api/health");
  if (!res.ok) throw new Error(`/api/health returned ${res.status}`);
  const health = await res.json();
  if (expected && health.environment !== expected)
    throw new Error(`Expected environment "${expected}" but got "${health.environment}"`);
  if (health.storage !== "ok") throw new Error(`R2 storage status is "${health.storage}"`);
  console.log(`✓ ${base} is healthy`, health);
});
