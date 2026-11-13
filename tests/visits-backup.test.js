/* Visitor beacon, visitor statistics and admin backup/restore endpoints. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../src/routes/api.js";
import { keys } from "../src/services/storage.js";
import { visitKey, deviceOf } from "../src/services/visits.js";
import { FakeR2 } from "./helpers/fake-r2.js";

const ORIGIN = "https://journal.test";
const UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const auth = {
  getSession: async (req) => (req.headers.get("X-Test-Owner") ? { ownerId: req.headers.get("X-Test-Owner"), username: req.headers.get("X-Test-Owner") } : null),
};

const placesDoc = (ownerId) => ({ schemaVersion: 1, ownerId, places: [] });

function setup() {
  const bucket = new FakeR2();
  for (const id of ["dovene", "sarah"]) {
    bucket.putJsonSync(keys.username(id), { ownerId: id });
    bucket.putJsonSync(keys.profile(id), { schemaVersion: 1, ownerId: id, username: id, displayName: id, description: { en: "Hi" } });
    bucket.putJsonSync(keys.places(id), placesDoc(id));
  }
  const env = { ENVIRONMENT: "test", STORAGE: bucket, SESSION_SECRET: "x".repeat(32) };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const call = async (method, path, { owner, body, headers = {}, cf } = {}) => {
    const init = { method, headers: { ...(method === "GET" ? {} : { Origin: ORIGIN }), "User-Agent": UA_PHONE, ...headers } };
    if (owner) init.headers["X-Test-Owner"] = owner;
    if (body !== undefined) {
      init.body = typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body);
      if (!(body instanceof Uint8Array)) init.headers["Content-Type"] ??= "application/json";
    }
    const req = new Request(ORIGIN + path, init);
    if (cf) Object.defineProperty(req, "cf", { value: cf });
    const res = await handleApi(req, env, ctx, auth);
    await Promise.all(waits.splice(0));
    return res;
  };
  return { bucket, call };
}

const today = () => new Date().toISOString().slice(0, 10);

describe("visitor beacon", () => {
  test("stores city, country, device and an anonymous id, never the IP", async () => {
    const { bucket, call } = setup();
    const res = await call("POST", "/api/public/dovene/visits", {
      body: { page: "place", slug: "berlin", lang: "fr", ref: "https://www.google.com/search?q=x" },
      headers: { "CF-Connecting-IP": "203.0.113.9" },
      cf: { city: "Lyon", region: "Auvergne-Rhône-Alpes", country: "FR" },
    });
    assert.equal(res.status, 204);
    const [v] = bucket.json(visitKey("dovene", today())).visits;
    assert.equal(v.p, "place");
    assert.equal(v.s, "berlin");
    assert.equal(v.ci, "Lyon");
    assert.equal(v.cc, "FR");
    assert.equal(v.dv, "mobile");
    assert.equal(v.rf, "google.com");
    assert.match(v.v, /^[0-9a-f]{16}$/);
    assert.doesNotMatch(JSON.stringify(v), /203\.0\.113\.9/);
  });

  test("the same visitor keeps the same id within a day; another IP gets another id", async () => {
    const { bucket, call } = setup();
    for (const ip of ["198.51.100.1", "198.51.100.1", "198.51.100.2"])
      await call("POST", "/api/public/dovene/visits", { body: { page: "home" }, headers: { "CF-Connecting-IP": ip } });
    const ids = bucket.json(visitKey("dovene", today())).visits.map((v) => v.v);
    assert.equal(ids.length, 3);
    assert.equal(ids[0], ids[1]);
    assert.notEqual(ids[0], ids[2]);
  });

  test("own visits, bots, cross-site posts and junk are not recorded", async () => {
    const { bucket, call } = setup();
    assert.equal((await call("POST", "/api/public/dovene/visits", { owner: "dovene", body: { page: "home" } })).status, 204);
    assert.equal((await call("POST", "/api/public/dovene/visits", { body: { page: "home" }, headers: { "User-Agent": "Googlebot/2.1" } })).status, 204);
    assert.equal((await call("POST", "/api/public/dovene/visits", { body: { page: "admin" } })).status, 204);
    assert.equal((await call("POST", "/api/public/dovene/visits", { body: { page: "place", slug: "../x" } })).status, 204);
    assert.equal((await call("POST", "/api/public/dovene/visits", { body: { page: "home" }, headers: { Origin: "https://evil.test" } })).status, 403);
    assert.equal(bucket.json(visitKey("dovene", today())), null);
  });

  test("only POST is allowed on the beacon", async () => {
    const { call } = setup();
    assert.equal((await call("GET", "/api/public/dovene/visits")).status, 405);
  });

  test("devices are recognised", () => {
    assert.equal(deviceOf(UA_PHONE), "mobile");
    assert.equal(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "tablet");
    assert.equal(deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"), "desktop");
  });
});

describe("visitor statistics", () => {
  test("the owner reads their own visits for a date range", async () => {
    const { bucket, call } = setup();
    bucket.putJsonSync(visitKey("dovene", "2026-11-01"), { schemaVersion: 1, ownerId: "dovene", date: "2026-11-01", visits: [{ t: "2026-11-01T10:00:00Z", p: "home", v: "a" }] });
    bucket.putJsonSync(visitKey("sarah", "2026-11-01"), { schemaVersion: 1, ownerId: "sarah", date: "2026-11-01", visits: [{ t: "2026-11-01T11:00:00Z", p: "home", v: "b" }] });
    const res = await call("GET", "/api/admin/visits?from=2026-10-30&to=2026-11-02", { owner: "dovene" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.visits.length, 1);
    assert.equal(body.visits[0].v, "a");
  });

  test("needs a session and a valid range of at most 31 days", async () => {
    const { call } = setup();
    assert.equal((await call("GET", "/api/admin/visits?from=2026-11-01&to=2026-11-02")).status, 401);
    assert.equal((await call("GET", "/api/admin/visits?from=2026-01-01&to=2026-03-01", { owner: "dovene" })).status, 400);
    assert.equal((await call("GET", "/api/admin/visits?from=nope&to=2026-03-01", { owner: "dovene" })).status, 400);
  });
});

describe("backup and restore", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(1)]);
  const put = (call, path, body, type, owner = "dovene") =>
    call("PUT", `/api/admin/backup/files?path=${encodeURIComponent(path)}`, {
      owner,
      body,
      headers: { "Content-Type": type, "Content-Length": String(typeof body === "string" ? new TextEncoder().encode(body).length : body.length) },
    });

  test("content export returns the three documents byte for byte", async () => {
    const { call } = setup();
    const body = await (await call("GET", "/api/admin/backup/content", { owner: "dovene" })).json();
    assert.deepEqual(body.files.map((f) => f.path), ["content/usernames/dovene.json", "content/users/dovene/profile.json", "content/users/dovene/places.json"]);
    assert.deepEqual(JSON.parse(body.files[2].text), placesDoc("dovene"));
  });

  test("media files are restored after checking type and owner", async () => {
    const { bucket, call } = setup();
    const path = "media/users/dovene/berlin-2026/img-abc.jpg";
    const ok = await put(call, path, JPEG, "image/jpeg");
    assert.equal(ok.status, 200);
    assert.equal(bucket.objects.get(path).bytes.length, JPEG.length);
    assert.equal((await put(call, "media/users/sarah/x/img-abc.jpg", JPEG, "image/jpeg")).status, 403);
    assert.equal((await put(call, "media/users/dovene/x/evil.html", JPEG, "image/jpeg")).status, 415);
    assert.equal((await put(call, "media/users/dovene/x/img-abc.jpg", new Uint8Array(64).fill(7), "image/jpeg")).status, 415);
    assert.equal((await put(call, "media/users/dovene/../sarah/img.jpg", JPEG, "image/jpeg")).status, 400);
    assert.equal((await put(call, "notes.txt", JPEG, "image/jpeg")).status, 400);
  });

  test("documents must be valid and belong to the signed-in owner", async () => {
    const { bucket, call } = setup();
    const good = JSON.stringify({ schemaVersion: 1, ownerId: "dovene", places: [] }, null, 2);
    assert.equal((await put(call, "content/users/dovene/places.json", good, "application/json")).status, 200);
    assert.equal(new TextDecoder().decode(bucket.objects.get("content/users/dovene/places.json").bytes), good, "stored byte for byte");
    assert.equal((await put(call, "content/users/dovene/places.json", JSON.stringify({ schemaVersion: 1, ownerId: "sarah", places: [] }), "application/json")).status, 422);
    assert.equal((await put(call, "content/users/dovene/places.json", "{not json", "application/json")).status, 400);
    assert.equal((await put(call, "content/users/dovene/places.json", JSON.stringify({ schemaVersion: 1, ownerId: "dovene", places: [{}] }), "application/json")).status, 422);
    assert.equal((await put(call, "content/usernames/sarah.json", JSON.stringify({ ownerId: "dovene" }), "application/json")).status, 403);
    assert.equal((await put(call, "content/usernames/dovene.json", JSON.stringify({ ownerId: "sarah" }), "application/json")).status, 422);
  });

  test("existing media are reported with their sizes, only for the owner", async () => {
    const { bucket, call } = setup();
    bucket.objects.set("media/users/dovene/p/img-a.jpg", { bytes: JPEG, etag: "e", uploaded: new Date(), httpMetadata: {} });
    bucket.objects.set("media/users/sarah/p/img-b.jpg", { bytes: JPEG, etag: "e", uploaded: new Date(), httpMetadata: {} });
    const res = await call("POST", "/api/admin/backup/existing", {
      owner: "dovene",
      body: { paths: ["media/users/dovene/p/img-a.jpg", "media/users/dovene/p/img-z.jpg", "media/users/sarah/p/img-b.jpg"] },
    });
    assert.deepEqual((await res.json()).existing, { "media/users/dovene/p/img-a.jpg": JPEG.length });
  });

  test("backup endpoints need a session and same-origin writes", async () => {
    const { call } = setup();
    assert.equal((await call("GET", "/api/admin/backup/content")).status, 401);
    const res = await call("PUT", "/api/admin/backup/files?path=content/users/dovene/places.json", {
      owner: "dovene",
      body: "{}",
      headers: { Origin: "https://evil.test" },
    });
    assert.equal(res.status, 403);
  });
});

describe("author profile", () => {
  test("the owner reads and renames their profile; the public profile shows the new name", async () => {
    const { bucket, call } = setup();
    assert.deepEqual(await (await call("GET", "/api/admin/profile", { owner: "dovene" })).json(), { displayName: "dovene" });
    const res = await call("PUT", "/api/admin/profile", { owner: "dovene", body: { displayName: "  Dov  " } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { displayName: "Dov" });
    const stored = bucket.json(keys.profile("dovene"));
    assert.equal(stored.displayName, "Dov");
    assert.equal(stored.description.en, "Hi", "other fields are kept");
    assert.equal(bucket.json(keys.profile("sarah")).displayName, "sarah", "other authors untouched");
    assert.equal((await (await call("GET", "/api/public/dovene/profile")).json()).displayName, "Dov");
  });

  test("the name must be 1 to 80 characters, and editing needs a session and same origin", async () => {
    const { call } = setup();
    assert.equal((await call("PUT", "/api/admin/profile", { owner: "dovene", body: { displayName: "   " } })).status, 422);
    assert.equal((await call("PUT", "/api/admin/profile", { owner: "dovene", body: { displayName: "x".repeat(81) } })).status, 422);
    assert.equal((await call("GET", "/api/admin/profile")).status, 401);
    assert.equal((await call("PUT", "/api/admin/profile", { owner: "dovene", body: { displayName: "Dov" }, headers: { Origin: "https://evil.test" } })).status, 403);
  });
});
