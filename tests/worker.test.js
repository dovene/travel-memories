import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const assets = {
  fetch: async (req) => new Response(`asset:${new URL(req.url).pathname}`, { status: 200 }),
};

function env(overrides = {}) {
  return {
    ENVIRONMENT: "test",
    ASSETS: assets,
    STORAGE: { head: async () => null },
    ...overrides,
  };
}

const call = (path, init, e = env()) => worker.fetch(new Request(`https://example.test${path}`, init), e, {});

test("GET /api/health reports environment and storage status", async () => {
  const res = await call("/api/health");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.environment, "test");
  assert.equal(body.storage, "ok");
});

test("health is degraded when R2 fails, without leaking the error", async () => {
  const res = await call("/api/health", {}, env({ STORAGE: { head: async () => { throw new Error("secret internal detail"); } } }));
  const body = await res.json();
  assert.equal(body.status, "degraded");
  assert.equal(body.storage, "error");
  assert.doesNotMatch(JSON.stringify(body), /secret internal detail/);
});

test("health reports an unbound bucket", async () => {
  const body = await (await call("/api/health", {}, env({ STORAGE: undefined }))).json();
  assert.equal(body.storage, "unbound");
});

test("unsupported method on health returns 405 with Allow header", async () => {
  const res = await call("/api/health", { method: "POST" });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "GET, HEAD");
});

test("unknown API routes return a JSON 404", async () => {
  const res = await call("/api/nope");
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: { code: "not_found", message: "Resource not found." } });
});

test("non-API paths fall through to static assets", async () => {
  const res = await call("/place.html");
  assert.equal(await res.text(), "asset:/place.html");
});

test("unexpected exceptions become a generic 500", async () => {
  const res = await call("/somewhere", {}, env({ ASSETS: { fetch: () => { throw new Error("boom"); } } }));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error.code, "internal_error");
});
