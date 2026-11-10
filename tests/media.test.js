import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../src/routes/api.js";
import { keys } from "../src/services/storage.js";
import { sniff, LIMITS } from "../src/services/uploads.js";
import { FakeR2 } from "./helpers/fake-r2.js";

const ORIGIN = "https://journal.test";
const testAuth = { getSession: async (req) => (req.headers.get("X-Test-Owner") ? { ownerId: req.headers.get("X-Test-Owner"), username: req.headers.get("X-Test-Owner") } : null) };

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(7)]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(1)]);
const ftyp = (brand) => Uint8Array.from([0, 0, 0, 24, ...Buffer.from("ftyp" + brand), ...new Array(40).fill(0)]);
const MP4 = ftyp("isom");

function setup() {
  const bucket = new FakeR2();
  const env = { STORAGE: bucket };
  const call = (method, path, { owner = "dovene", body, headers = {} } = {}) => {
    const init = { method, headers: { ...(method === "GET" ? {} : { Origin: ORIGIN }), ...headers } };
    if (owner) init.headers["X-Test-Owner"] = owner;
    if (body !== undefined) {
      if (body instanceof Uint8Array) {
        init.body = body;
        init.headers["Content-Length"] ??= String(body.length);
      } else {
        init.body = JSON.stringify(body);
        init.headers["Content-Type"] = "application/json";
      }
    }
    return handleApi(new Request(ORIGIN + path, init), env, {}, testAuth);
  };
  const upload = (placeId, bytes, type, name, extra = {}) =>
    call("POST", `/api/admin/places/${placeId}/media`, { body: bytes, headers: { "Content-Type": type, "X-Filename": encodeURIComponent(name), ...extra.headers }, owner: extra.owner });
  return { bucket, call, upload };
}

async function newPlace(call, owner = "dovene") {
  const res = await call("POST", "/api/admin/places", { owner, body: { name: { en: "Kyoto" }, city: "Kyoto", country: { en: "Japan" }, countryCode: "JP" } });
  return res.json();
}

describe("file signature detection", () => {
  test("recognises allowed formats and rejects others", () => {
    assert.equal(sniff(JPEG), "image/jpeg");
    assert.equal(sniff(PNG), "image/png");
    assert.equal(sniff(Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")])), "image/webp");
    assert.equal(sniff(ftyp("heic")), "image/heic");
    assert.equal(sniff(ftyp("avif")), "image/avif");
    assert.equal(sniff(MP4), "video/mp4");
    assert.equal(sniff(ftyp("qt  ")), "video/quicktime");
    assert.equal(sniff(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])), "video/webm");
    assert.equal(sniff(Buffer.from("<html><script>")), null);
    assert.equal(sniff(Buffer.from("%PDF-1.7")), null);
  });
});

describe("uploads", () => {
  test("a photo is stored as the original bytes and becomes the cover", async () => {
    const { bucket, upload } = setup();
    const place = await newPlace(setupCall(bucket));
    const res = await upload(place.id, JPEG, "image/jpeg", "Gion at night.JPG", { headers: { "X-Media-Width": "4000", "X-Media-Height": "3000" } });
    assert.equal(res.status, 201);
    const updated = await res.json();
    const m = updated.media[0];
    assert.equal(m.type, "image");
    assert.equal(m.contentType, "image/jpeg");
    assert.equal(m.size, JPEG.length);
    assert.equal(m.originalFilename, "Gion at night.JPG");
    assert.deepEqual([m.width, m.height], [4000, 3000]);
    assert.equal(m.altText.en, "Gion at night");
    assert.match(m.filename, /^img-[a-z0-9]+\.jpg$/);
    assert.equal(m.url, `/api/public/dovene/media/${m.id}`);
    assert.equal(updated.coverMediaId, m.id);
    assert.equal(updated.version, 2);
    const stored = await bucket.get(keys.media("dovene", place.id, m.filename));
    assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), JPEG);
  });

  test("rejects wrong type, extension, content, size and missing length", async () => {
    const { bucket, upload } = setup();
    const place = await setupCall(bucket)("POST", "/api/admin/places", { body: { name: { en: "A" }, city: "A", country: { en: "A" }, countryCode: "AA" } }).then((r) => r.json());
    const cases = [
      [JPEG, "application/pdf", "a.pdf", 415, "unsupported_media_type"],
      [JPEG, "image/jpeg", "a.png", 415, "extension_mismatch"],
      [JPEG, "image/jpeg", "noextension", 415, "extension_mismatch"],
      [Uint8Array.from(Buffer.from("<script>alert(1)</script>")), "image/jpeg", "evil.jpg", 415, "content_mismatch"],
      [PNG, "image/jpeg", "mislabelled.jpg", 415, "content_mismatch"],
    ];
    for (const [bytes, type, name, status, code] of cases) {
      const res = await upload(place.id, bytes, type, name);
      assert.equal(res.status, status, name);
      assert.equal((await res.json()).error.code, code, name);
    }
    const big = await upload(place.id, JPEG, "image/jpeg", "big.jpg", { headers: { "Content-Length": String(LIMITS.image + 1) } });
    assert.equal(big.status, 413);
    assert.equal(bucket.json(keys.places("dovene")).places[0].media.length, 0, "nothing was added");
    assert.deepEqual((await bucket.list({ prefix: "media/" })).objects, [], "no stray files");
  });

  test("a .mov holding MP4 data is accepted and stored with the detected type", async () => {
    const { bucket, upload } = setup();
    const place = await setupCall(bucket)("POST", "/api/admin/places", { body: { name: { en: "A" }, city: "A", country: { en: "A" }, countryCode: "AA" } }).then((r) => r.json());
    const res = await upload(place.id, MP4, "video/quicktime", "clip.MOV");
    assert.equal(res.status, 201);
    const m = (await res.json()).media[0];
    assert.equal(m.type, "video");
    assert.equal(m.contentType, "video/mp4");
  });

  test("uploads require a session, the owner's place and a same-site origin", async () => {
    const { bucket, upload } = setup();
    const sarahs = await setupCall(bucket)("POST", "/api/admin/places", { owner: "sarah", body: { name: { en: "S" }, city: "S", country: { en: "S" }, countryCode: "SS" } }).then((r) => r.json());
    assert.equal((await upload(sarahs.id, JPEG, "image/jpeg", "a.jpg", { owner: null })).status, 401);
    assert.equal((await upload(sarahs.id, JPEG, "image/jpeg", "a.jpg")).status, 404, "dovene cannot upload into sarah's place");
    assert.equal((await upload(sarahs.id, JPEG, "image/jpeg", "a.jpg", { owner: "sarah", headers: { Origin: "https://evil.test" } })).status, 403);
    assert.deepEqual((await bucket.list({ prefix: "media/" })).objects, []);
  });

  test("if saving the document fails, the uploaded file is removed", async () => {
    const { bucket, upload } = setup();
    const place = await setupCall(bucket)("POST", "/api/admin/places", { body: { name: { en: "A" }, city: "A", country: { en: "A" }, countryCode: "AA" } }).then((r) => r.json());
    bucket.beforePut = async (key) => {
      if (key !== keys.places("dovene")) return;
      const doc = bucket.json(key);
      doc.places[0].city = `A ${Math.random()}`; // someone else keeps editing → the save never lands
      bucket.putJsonSync(key, doc);
    };
    const res = await upload(place.id, JPEG, "image/jpeg", "a.jpg");
    assert.equal(res.status, 409);
    assert.deepEqual((await bucket.list({ prefix: "media/" })).objects, []);
  });
});

describe("managing media", () => {
  async function placeWithThree() {
    const ctx = setup();
    const place = await setupCall(ctx.bucket)("POST", "/api/admin/places", { body: { name: { en: "A" }, city: "A", country: { en: "A" }, countryCode: "AA" } }).then((r) => r.json());
    const ids = [];
    for (const [bytes, type, name] of [[JPEG, "image/jpeg", "1.jpg"], [PNG, "image/png", "2.png"], [MP4, "video/mp4", "3.mp4"]]) {
      const p = await (await ctx.upload(place.id, bytes, type, name)).json();
      ids.push(p.media.at(-1).id);
    }
    return { ...ctx, place, ids };
  }

  test("reorder must list exactly the current media", async () => {
    const { call, place, ids } = await placeWithThree();
    const res = await call("PUT", `/api/admin/places/${place.id}/media/order`, { body: { order: [ids[2], ids[0], ids[1]] } });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).media.map((m) => [m.id, m.position]), [[ids[2], 0], [ids[0], 1], [ids[1], 2]]);

    const stale = await call("PUT", `/api/admin/places/${place.id}/media/order`, { body: { order: [ids[0], ids[1]] } });
    assert.equal(stale.status, 409);
    assert.deepEqual((await stale.json()).error.details.currentOrder, [ids[2], ids[0], ids[1]]);
    assert.equal((await call("PUT", `/api/admin/places/${place.id}/media/order`, { body: { order: "nope" } })).status, 422);
  });

  test("cover can be set to any of the place's media", async () => {
    const { call, place, ids } = await placeWithThree();
    const res = await call("PUT", `/api/admin/places/${place.id}/media/cover`, { body: { mediaId: ids[2] } });
    assert.equal((await res.json()).coverMediaId, ids[2]);
    assert.equal((await call("PUT", `/api/admin/places/${place.id}/media/cover`, { body: { mediaId: "img-nope" } })).status, 404);
  });

  test("deleting media renumbers positions, moves the cover and removes the file", async () => {
    const { bucket, call, place, ids } = await placeWithThree();
    const before = bucket.json(keys.places("dovene")).places[0].media.find((m) => m.id === ids[0]);
    const res = await call("DELETE", `/api/admin/places/${place.id}/media/${ids[0]}`);
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.deepEqual(updated.media.map((m) => [m.id, m.position]), [[ids[1], 0], [ids[2], 1]]);
    assert.equal(updated.coverMediaId, ids[1], "cover moves to the first remaining item");
    assert.equal(await bucket.head(keys.media("dovene", place.id, before.filename)), null);
    assert.equal((await call("DELETE", `/api/admin/places/${place.id}/media/${ids[0]}`)).status, 404);
  });

  test("another owner cannot reorder, change the cover or delete media", async () => {
    const { call, place, ids } = await placeWithThree();
    const as = { owner: "sarah" };
    assert.equal((await call("PUT", `/api/admin/places/${place.id}/media/order`, { ...as, body: { order: ids } })).status, 404);
    assert.equal((await call("PUT", `/api/admin/places/${place.id}/media/cover`, { ...as, body: { mediaId: ids[1] } })).status, 404);
    assert.equal((await call("DELETE", `/api/admin/places/${place.id}/media/${ids[1]}`, as)).status, 404);
  });
});

/* A JSON caller bound to a bucket (used to create places before uploading). */
function setupCall(bucket) {
  const env = { STORAGE: bucket };
  return (method, path, { owner = "dovene", body } = {}) =>
    handleApi(
      new Request(ORIGIN + path, { method, headers: { Origin: ORIGIN, "X-Test-Owner": owner, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      env, {}, testAuth
    );
}
