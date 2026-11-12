import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../src/routes/api.js";
import { keys } from "../src/services/storage.js";
import { FakeR2 } from "./helpers/fake-r2.js";

const ORIGIN = "https://journal.test";

/* Tests sign in by sending X-Test-Owner; the real app never reads this header. */
const testAuth = { getSession: async (req) => (req.headers.get("X-Test-Owner") ? { ownerId: req.headers.get("X-Test-Owner") } : null) };

function setup() {
  const bucket = new FakeR2();
  for (const [ownerId, username, name] of [["dovene", "dovene", "Travel Memories"], ["sarah", "sarah", "Sarah's trips"]]) {
    bucket.putJsonSync(keys.username(username), { ownerId });
    bucket.putJsonSync(keys.profile(ownerId), { schemaVersion: 1, ownerId, username, displayName: name, description: { en: "Hello" } });
  }
  const env = { ENVIRONMENT: "test", STORAGE: bucket };
  const call = (method, path, { owner, body, headers = {} } = {}) => {
    // Browsers send Origin on every POST/PUT/DELETE; tests do the same unless overridden.
    const init = { method, headers: { ...(method === "GET" || method === "HEAD" ? {} : { Origin: ORIGIN }), ...headers } };
    if (owner) init.headers["X-Test-Owner"] = owner;
    if (body !== undefined) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
      init.headers["Content-Type"] ??= "application/json";
    }
    return handleApi(new Request(ORIGIN + path, init), env, {}, testAuth);
  };
  return { bucket, env, call };
}

const berlin = { name: { en: "Berlin", fr: "Berlin" }, description: { en: "Walks." }, city: "Berlin", country: { en: "Germany", fr: "Allemagne" }, countryCode: "de", visitedAt: "2026-03" };

describe("public API", () => {
  test("profile resolves the username to its owner", async () => {
    const { call } = setup();
    const res = await call("GET", "/api/public/dovene/profile");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.displayName, "Travel Memories");
    assert.ok(res.headers.get("etag"));
  });

  test("unknown username and malformed usernames are 404", async () => {
    const { call } = setup();
    assert.equal((await call("GET", "/api/public/nobody/places")).status, 404);
    assert.equal((await call("GET", "/api/public/..%2Fetc/places")).status, 404);
  });

  test("places list is empty for a new journal and supports 304 revalidation", async () => {
    const { call } = setup();
    await call("POST", "/api/admin/places", { owner: "dovene", body: berlin });
    const res = await call("GET", "/api/public/dovene/places");
    const etag = res.headers.get("etag");
    assert.equal((await res.json()).places.length, 1);
    const again = await call("GET", "/api/public/dovene/places", { headers: { "If-None-Match": etag } });
    assert.equal(again.status, 304);
    assert.deepEqual((await (await call("GET", "/api/public/sarah/places")).json()).places, []);
  });

  test("place by slug includes generated media URLs in position order", async () => {
    const { bucket, call } = setup();
    const created = await (await call("POST", "/api/admin/places", { owner: "dovene", body: berlin })).json();
    const doc = bucket.json(keys.places("dovene"));
    doc.places[0].media = [
      { id: "m-b", type: "video", filename: "b.mp4", contentType: "video/mp4", size: 100, position: 1 },
      { id: "m-a", type: "image", filename: "a.jpg", contentType: "image/jpeg", size: 50, position: 0 },
    ];
    doc.places[0].coverMediaId = "m-a";
    bucket.putJsonSync(keys.places("dovene"), doc);

    const place = await (await call("GET", `/api/public/dovene/places/${created.slug}`)).json();
    assert.deepEqual(place.media.map((m) => m.id), ["m-a", "m-b"]);
    assert.equal(place.media[0].url, "/api/public/dovene/media/m-a");
  });

  test("media is streamed with stored content type, caching, 304 and byte ranges", async () => {
    const { bucket, call } = setup();
    const created = await (await call("POST", "/api/admin/places", { owner: "dovene", body: berlin })).json();
    const doc = bucket.json(keys.places("dovene"));
    doc.places[0].media = [{ id: "clip", type: "video", filename: "clip.mp4", contentType: "video/mp4", size: 100, position: 0 }];
    doc.places[0].coverMediaId = "clip";
    bucket.putJsonSync(keys.places("dovene"), doc);
    await bucket.put(keys.media("dovene", created.id, "clip.mp4"), new Uint8Array(100).map((_, i) => i));

    const full = await call("GET", "/api/public/dovene/media/clip");
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "video/mp4");
    assert.match(full.headers.get("cache-control"), /immutable/);
    assert.equal((await full.arrayBuffer()).byteLength, 100);

    const part = await call("GET", "/api/public/dovene/media/clip", { headers: { Range: "bytes=10-19" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 10-19/100");
    assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

    const cached = await call("GET", "/api/public/dovene/media/clip", { headers: { "If-None-Match": full.headers.get("etag") } });
    assert.equal(cached.status, 304);

    // Another owner's journal cannot serve this media id.
    assert.equal((await call("GET", "/api/public/sarah/media/clip")).status, 404);
  });

  test("public endpoints are read-only", async () => {
    const { call } = setup();
    assert.equal((await call("POST", "/api/public/dovene/places", { body: berlin })).status, 405);
  });
});

describe("admin API — authentication and input", () => {
  test("every admin data route requires a session", async () => {
    const { call } = setup();
    for (const [m, p] of [["GET", "/api/admin/places"], ["POST", "/api/admin/places"], ["PUT", "/api/admin/places/x"], ["DELETE", "/api/admin/places/x"]]) {
      const res = await call(m, p, { body: m === "GET" || m === "DELETE" ? undefined : berlin });
      assert.equal(res.status, 401, `${m} ${p}`);
    }
    assert.deepEqual(await (await call("GET", "/api/admin/session")).json(), { authenticated: false });
  });

  test("create validates input and reports field errors", async () => {
    const { call } = setup();
    const res = await call("POST", "/api/admin/places", { owner: "dovene", body: { name: { en: "" }, city: "x".repeat(81), countryCode: "Germany" } });
    assert.equal(res.status, 422);
    const paths = (await res.json()).error.details.map((d) => d.path).sort();
    assert.deepEqual(paths, ["/city", "/country", "/countryCode", "/name/en"]);
  });

  test("the browser cannot choose the owner or server-controlled fields", async () => {
    const { call } = setup();
    const res = await call("POST", "/api/admin/places", { owner: "dovene", body: { ...berlin, ownerId: "sarah", version: 99, id: "x" } });
    assert.equal(res.status, 422);
    const paths = (await res.json()).error.details.map((d) => d.path);
    assert.ok(paths.includes("/ownerId") && paths.includes("/version") && paths.includes("/id"));
  });

  test("rejects non-JSON, malformed JSON and cross-site requests", async () => {
    const { call } = setup();
    assert.equal((await call("POST", "/api/admin/places", { owner: "dovene", body: "x", headers: { "Content-Type": "text/plain" } })).status, 415);
    assert.equal((await call("POST", "/api/admin/places", { owner: "dovene", body: "{oops" })).status, 400);
    assert.equal((await call("POST", "/api/admin/places", { owner: "dovene", body: berlin, headers: { Origin: "https://evil.test" } })).status, 403);
    assert.equal((await call("POST", "/api/admin/places", { owner: "dovene", body: berlin, headers: { Origin: ORIGIN } })).status, 201);
  });

  test("state-changing requests without an Origin header are refused", async () => {
    const { call } = setup();
    const res = await handleApi(
      new Request(ORIGIN + "/api/admin/places", { method: "POST", headers: { "X-Test-Owner": "dovene", "Content-Type": "application/json" }, body: JSON.stringify(berlin) }),
      { STORAGE: new FakeR2() }, {}, testAuth
    );
    assert.equal(res.status, 403);
    assert.equal((await call("GET", "/api/admin/places", { owner: "dovene" })).status, 200, "reads need no Origin");
  });
});

describe("admin API — places lifecycle", () => {
  test("create → read → update → delete", async () => {
    const { bucket, call } = setup();
    const res = await call("POST", "/api/admin/places", { owner: "dovene", body: berlin });
    assert.equal(res.status, 201);
    const place = await res.json();
    assert.equal(place.ownerId, "dovene");
    assert.equal(place.slug, "berlin");
    assert.equal(place.countryCode, "DE");
    assert.equal(place.version, 1);
    assert.equal(res.headers.get("etag"), '"1"');
    assert.equal(res.headers.get("location"), `/api/admin/places/${place.id}`);

    // Stored document is valid, versioned and owned.
    const stored = bucket.json(keys.places("dovene"));
    assert.equal(stored.schemaVersion, 1);
    assert.equal(stored.places[0].id, place.id);

    const upd = await call("PUT", `/api/admin/places/${place.id}`, { owner: "dovene", body: { description: { en: "More walks.", fr: "" } }, headers: { "If-Match": '"1"' } });
    assert.equal(upd.status, 200);
    const updated = await upd.json();
    assert.equal(updated.version, 2);
    assert.deepEqual(updated.description, { en: "More walks." });
    assert.equal(updated.name.en, "Berlin");

    // A media file under the place folder is removed with the place.
    await bucket.put(keys.media("dovene", place.id, "a.jpg"), "img");
    const del = await call("DELETE", `/api/admin/places/${place.id}`, { owner: "dovene", headers: { "If-Match": '"2"' } });
    assert.equal(del.status, 204);
    assert.deepEqual(bucket.json(keys.places("dovene")).places, []);
    assert.equal(await bucket.head(keys.media("dovene", place.id, "a.jpg")), null);
  });

  test("slugs stay unique per owner", async () => {
    const { call } = setup();
    const a = await (await call("POST", "/api/admin/places", { owner: "dovene", body: berlin })).json();
    const b = await (await call("POST", "/api/admin/places", { owner: "dovene", body: berlin })).json();
    const c = await (await call("POST", "/api/admin/places", { owner: "sarah", body: berlin })).json();
    assert.deepEqual([a.slug, b.slug, c.slug], ["berlin", "berlin-2", "berlin"]);
    const r = await call("PUT", `/api/admin/places/${b.id}`, { owner: "dovene", body: { slug: "berlin" }, headers: { "If-Match": "1" } });
    assert.equal((await r.json()).slug, "berlin-2");
  });
});

describe("conflicts and owner isolation", () => {
  test("updates and deletes require the current version", async () => {
    const { call } = setup();
    const place = await (await call("POST", "/api/admin/places", { owner: "dovene", body: berlin })).json();
    const missing = await call("PUT", `/api/admin/places/${place.id}`, { owner: "dovene", body: { city: "X" } });
    assert.equal(missing.status, 428);

    await call("PUT", `/api/admin/places/${place.id}`, { owner: "dovene", body: { city: "Berlin-Mitte" }, headers: { "If-Match": '"1"' } });
    const stale = await call("PUT", `/api/admin/places/${place.id}`, { owner: "dovene", body: { city: "Overwrite" }, headers: { "If-Match": '"1"' } });
    assert.equal(stale.status, 412);
    assert.equal((await stale.json()).error.details.currentVersion, 2);

    assert.equal((await call("DELETE", `/api/admin/places/${place.id}`, { owner: "dovene", headers: { "If-Match": '"1"' } })).status, 412);
    assert.equal((await call("PUT", `/api/admin/places/${place.id}`, { owner: "dovene", body: {}, headers: { "If-Match": "abc" } })).status, 400);
  });

  test("a concurrent storage write is retried on fresh data, never overwritten", async () => {
    const { bucket, call } = setup();
    const first = await (await call("POST", "/api/admin/places", { owner: "dovene", body: berlin })).json();

    // Just before our next write lands, another request adds a place.
    let interfered = false;
    bucket.beforePut = async (key) => {
      if (interfered || key !== keys.places("dovene")) return;
      interfered = true;
      const doc = bucket.json(keys.places("dovene"));
      doc.places.push({ ...doc.places[0], id: "rome-zzzzzz", slug: "rome", name: { en: "Rome" } });
      bucket.putJsonSync(keys.places("dovene"), doc);
    };
    const res = await call("PUT", `/api/admin/places/${first.id}`, { owner: "dovene", body: { city: "Berlin-Mitte" }, headers: { "If-Match": '"1"' } });
    assert.equal(res.status, 200);
    const stored = bucket.json(keys.places("dovene")).places;
    assert.deepEqual(stored.map((p) => p.slug).sort(), ["berlin", "rome"], "both changes survive");
    assert.equal(stored.find((p) => p.id === first.id).city, "Berlin-Mitte");
  });

  test("persistent contention ends in an explicit 409", async () => {
    const { bucket, call } = setup();
    await call("POST", "/api/admin/places", { owner: "dovene", body: berlin });
    let n = 0;
    bucket.beforePut = async (key) => {
      if (key !== keys.places("dovene")) return;
      const doc = bucket.json(key);
      doc.places[0].city = `Berlin ${++n}`; // someone else keeps editing, so the ETag changes every time
      bucket.putJsonSync(key, doc);
    };
    const res = await call("POST", "/api/admin/places", { owner: "dovene", body: { ...berlin, name: { en: "Rome" } } });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.code, "storage_conflict");
  });

  test("an owner cannot read, change or delete another owner's place", async () => {
    const { bucket, call } = setup();
    const theirs = await (await call("POST", "/api/admin/places", { owner: "sarah", body: berlin })).json();
    assert.equal((await call("GET", `/api/admin/places/${theirs.id}`, { owner: "dovene" })).status, 404);
    assert.equal((await call("PUT", `/api/admin/places/${theirs.id}`, { owner: "dovene", body: { city: "Hacked" }, headers: { "If-Match": "1" } })).status, 404);
    assert.equal((await call("DELETE", `/api/admin/places/${theirs.id}`, { owner: "dovene", headers: { "If-Match": "1" } })).status, 404);
    assert.equal(bucket.json(keys.places("sarah")).places[0].city, "Berlin");
    assert.deepEqual((await (await call("GET", "/api/admin/places", { owner: "dovene" })).json()).places, []);
  });
});

describe("featured destinations and display order", () => {
  const trip = (name, visitedAt, extra = {}) => ({ ...berlin, name: { en: name }, visitedAt, ...extra });

  test("featured first, then the most recent trip, then the most recently created", async () => {
    const { call } = setup();
    await call("POST", "/api/admin/places", { owner: "dovene", body: trip("Old trip", "2019-05") });
    await call("POST", "/api/admin/places", { owner: "dovene", body: trip("Year only", "2024") });
    await call("POST", "/api/admin/places", { owner: "dovene", body: trip("Recent", "2026-03") });
    await call("POST", "/api/admin/places", { owner: "dovene", body: { ...berlin, name: { en: "No date" }, visitedAt: undefined } });
    await call("POST", "/api/admin/places", { owner: "dovene", body: trip("Favourite", "2018-01", { featured: true }) });
    await call("POST", "/api/admin/places", { owner: "dovene", body: trip("Mid 2024", "2024-07") });

    const names = async (path) => (await (await call("GET", path, { owner: "dovene" })).json()).places.map((p) => p.name.en);
    const expected = ["Favourite", "Recent", "Mid 2024", "Year only", "Old trip", "No date"];
    assert.deepEqual(await names("/api/public/dovene/places"), expected);
    assert.deepEqual(await names("/api/admin/places"), expected, "the admin list uses the same order");
  });

  test("the trip date is optional: empty on create, and can be cleared when editing", async () => {
    const { call } = setup();
    const created = await call("POST", "/api/admin/places", { owner: "dovene", body: { ...berlin, visitedAt: "" } });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).visitedAt, undefined);
    const place = await (await call("POST", "/api/admin/places", { owner: "dovene", body: { ...berlin, name: { en: "Dated" } } })).json();
    const res = await call("PUT", `/api/admin/places/${place.id}`, { owner: "dovene", body: { visitedAt: "" }, headers: { "If-Match": '"1"' } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).visitedAt, undefined);
    const bad = await call("PUT", `/api/admin/places/${place.id}`, { owner: "dovene", body: { visitedAt: "2026-13" }, headers: { "If-Match": '"2"' } });
    assert.equal(bad.status, 422);
  });

  test("the flag can be switched on and off, and only accepts true or false", async () => {
    const { bucket, call } = setup();
    const place = await (await call("POST", "/api/admin/places", { owner: "dovene", body: berlin })).json();
    assert.equal(place.featured, undefined, "not featured by default");

    const on = await (await call("PUT", `/api/admin/places/${place.id}`, { owner: "dovene", body: { featured: true }, headers: { "If-Match": '"1"' } })).json();
    assert.equal(on.featured, true);
    const off = await (await call("PUT", `/api/admin/places/${place.id}`, { owner: "dovene", body: { featured: false }, headers: { "If-Match": '"2"' } })).json();
    assert.equal(off.featured, undefined, "switching off removes the flag from the stored document");
    assert.equal("featured" in bucket.json(keys.places("dovene")).places[0], false);

    const bad = await call("PUT", `/api/admin/places/${place.id}`, { owner: "dovene", body: { featured: "yes" }, headers: { "If-Match": '"3"' } });
    assert.equal(bad.status, 422);
    assert.deepEqual((await bad.json()).error.details.map((d) => d.path), ["/featured"]);
  });
});
