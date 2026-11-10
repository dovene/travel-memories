/*
 * Content storage on R2 (or any S3-compatible store with conditional writes).
 *
 * Layout (portable, readable without the application):
 *   content/usernames/<username>.json          { "ownerId": "..." }  — public handle → owner
 *   content/users/<ownerId>/profile.json        profile document
 *   content/users/<ownerId>/places.json         all places of the owner
 *   media/users/<ownerId>/<placeId>/<filename>  original photos and videos
 *
 * Writes are conditional on the ETag that was read, so a concurrent change is never
 * silently overwritten: the write fails and the caller retries or reports a conflict.
 */
import { ApiError } from "../utils/responses.js";
import { validatePlacesDocument, validateProfile } from "../utils/validation.js";

export const SCHEMA_VERSION = 1;
const MAX_ATTEMPTS = 3;

export const keys = {
  username: (username) => `content/usernames/${username}.json`,
  profile: (ownerId) => `content/users/${ownerId}/profile.json`,
  places: (ownerId) => `content/users/${ownerId}/places.json`,
  mediaFolder: (ownerId, placeId) => `media/users/${ownerId}/${placeId}/`,
  media: (ownerId, placeId, filename) => `media/users/${ownerId}/${placeId}/${filename}`,
};

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
function assertSegment(value, what) {
  // Owner, place and username values become part of object keys: never allow traversal.
  if (typeof value !== "string" || !SAFE_SEGMENT.test(value)) throw new ApiError(400, "invalid_identifier", `Invalid ${what}.`);
}

export class ContentStore {
  constructor(bucket) {
    if (!bucket) throw new ApiError(503, "storage_unavailable", "Storage is not configured.");
    this.bucket = bucket;
  }

  async readJson(key) {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    let data;
    try {
      data = JSON.parse(await obj.text());
    } catch {
      console.error("Corrupt JSON document", { key });
      throw new ApiError(500, "corrupt_document", "Stored content could not be read.");
    }
    if (data && data.schemaVersion !== undefined && data.schemaVersion !== SCHEMA_VERSION) {
      console.error("Unsupported schema version", { key, schemaVersion: data.schemaVersion });
      throw new ApiError(500, "unsupported_schema", "Stored content uses an unsupported format version.");
    }
    return { data, etag: obj.etag };
  }

  /* Returns true when written, false when the precondition failed (someone else wrote first). */
  async writeJson(key, data, etag) {
    const onlyIf = etag ? { etagMatches: etag } : { etagDoesNotMatch: "*" };
    const res = await this.bucket.put(key, JSON.stringify(data, null, 2) + "\n", {
      onlyIf,
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
    return res !== null;
  }

  /* ---- Owners ---- */

  async resolveUsername(username) {
    if (typeof username !== "string" || !SAFE_SEGMENT.test(username)) return null;
    const entry = await this.readJson(keys.username(username));
    return entry && typeof entry.data.ownerId === "string" ? entry.data.ownerId : null;
  }

  async getProfile(ownerId) {
    assertSegment(ownerId, "owner");
    return this.readJson(keys.profile(ownerId));
  }

  async saveProfile(profile, etag) {
    assertSegment(profile.ownerId, "owner");
    const errors = validateProfile(profile);
    if (errors.length) throw new ApiError(422, "invalid_content", "The profile is not valid.", errors);
    return this.writeJson(keys.profile(profile.ownerId), profile, etag);
  }

  /* ---- Places ---- */

  async getPlaces(ownerId) {
    assertSegment(ownerId, "owner");
    const doc = await this.readJson(keys.places(ownerId));
    return doc || { data: { schemaVersion: SCHEMA_VERSION, ownerId, places: [] }, etag: null };
  }

  /*
   * Read-modify-write of an owner's places document.
   * `mutate(doc)` changes the document in place and returns a result; it may throw ApiError.
   * The new document is validated, then written only if nobody changed it meanwhile.
   * On a concurrent change the whole operation is retried against the fresh document,
   * so business checks (e.g. If-Match versions) are re-evaluated on current data.
   */
  async mutatePlaces(ownerId, mutate) {
    assertSegment(ownerId, "owner");
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { data, etag } = await this.getPlaces(ownerId);
      const result = await mutate(data);
      const errors = validatePlacesDocument(data);
      if (errors.length) throw new ApiError(422, "invalid_content", "The change would produce invalid content.", errors);
      if (await this.writeJson(keys.places(ownerId), data, etag)) return result;
    }
    throw new ApiError(409, "storage_conflict", "The content was changed by another request. Please retry.");
  }

  /* ---- Media files ---- */

  async getMediaObject(ownerId, placeId, filename, options) {
    assertSegment(ownerId, "owner");
    assertSegment(placeId, "place");
    return this.bucket.get(keys.media(ownerId, placeId, filename), options);
  }

  /* Deletes every object under a place's media folder. */
  async deleteMediaFolder(ownerId, placeId) {
    assertSegment(ownerId, "owner");
    assertSegment(placeId, "place");
    const prefix = keys.mediaFolder(ownerId, placeId);
    let cursor;
    do {
      const page = await this.bucket.list({ prefix, cursor, limit: 1000 });
      const objectKeys = page.objects.map((o) => o.key);
      if (objectKeys.length) await this.bucket.delete(objectKeys);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}
