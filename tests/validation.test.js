import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../src/utils/schema.js";
import { validatePlacesDocument, validateProfile } from "../src/utils/validation.js";

const place = (over = {}) => ({
  id: "berlin-abc123",
  ownerId: "dovene",
  slug: "berlin",
  version: 1,
  name: { en: "Berlin" },
  city: "Berlin",
  country: { en: "Germany", fr: "Allemagne" },
  countryCode: "DE",
  coverMediaId: null,
  media: [],
  createdAt: "2026-11-10T10:00:00Z",
  updatedAt: "2026-11-10T10:00:00Z",
  ...over,
});
const doc = (places) => ({ schemaVersion: 1, ownerId: "dovene", places });
const img = (id, position) => ({ id, type: "image", filename: `${id}.jpg`, contentType: "image/jpeg", size: 10, position });
const messages = (errors) => errors.map((e) => `${e.path} ${e.message}`);

test("a valid document passes", () => {
  assert.deepEqual(validatePlacesDocument(doc([place(), place({ id: "rome-abc123", slug: "rome", media: [img("m1", 0), img("m2", 1)], coverMediaId: "m2" })])), []);
});

test("schema errors carry JSON-pointer paths", () => {
  const errors = validatePlacesDocument(doc([place({ countryCode: "de", name: {}, extra: 1 })]));
  assert.deepEqual(messages(errors).sort(), ["/places/0/countryCode has an invalid format", "/places/0/extra is not allowed", "/places/0/name/en is required"]);
});

test("cross-field rules: owner, unique ids and slugs, cover, positions, media types", () => {
  const errors = messages(
    validatePlacesDocument(
      doc([
        place({ ownerId: "sarah" }),
        place({ media: [img("m1", 0), img("m1", 2)], coverMediaId: "nope" }),
        place({ id: "x-1", slug: "x", media: [{ ...img("v", 0), type: "video" }], coverMediaId: "v" }),
        place({ id: "y-1", slug: "y", coverMediaId: "ghost" }),
      ])
    )
  );
  for (const expected of [
    "/places/0/ownerId must match the document owner",
    "/places/1/id must be unique",
    "/places/1/slug must be unique",
    "/places/1/media positions must run from 0 to n-1 without gaps",
    "/places/1/media/1/id must be unique",
    "/places/1/coverMediaId must reference an existing media item",
    "/places/2/media/0/contentType does not match type video",
    "/places/3/coverMediaId must be null when there is no media",
  ])
    assert.ok(errors.includes(expected), `missing: ${expected}\n got: ${errors.join("\n")}`);
});

test("schema version is enforced", () => {
  assert.ok(messages(validatePlacesDocument({ ...doc([]), schemaVersion: 2 })).includes("/schemaVersion must be 1"));
});

test("profile schema", () => {
  assert.deepEqual(validateProfile({ schemaVersion: 1, ownerId: "dovene", username: "dovene", displayName: "Travel Memories" }), []);
  assert.ok(messages(validateProfile({ schemaVersion: 1, ownerId: "dovene", username: "Bad Name", displayName: "" })).length === 2);
});

test("unsupported schema keywords are refused instead of silently ignored", () => {
  assert.throws(() => validate({ type: "string", format: "email" }, "x"), /Unsupported schema keyword "format"/);
});

test("filenames cannot escape the media folder", () => {
  const errors = messages(validatePlacesDocument(doc([place({ media: [{ ...img("m", 0), filename: "../../secret" }], coverMediaId: "m" })])));
  assert.ok(errors.includes("/places/0/media/0/filename has an invalid format"));
});
