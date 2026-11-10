/*
 * Destination management for one owner. The ownerId always comes from the
 * authenticated session (or the resolved public username), never from request bodies.
 */
import { ApiError } from "../utils/responses.js";
import { validatePlaceInput } from "../utils/validation.js";

const EDITABLE = ["name", "description", "city", "country", "countryCode", "visitedAt", "slug"];

export function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function randomSuffix(length = 6) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function uniqueSlug(base, places, ignoreId) {
  const taken = new Set(places.filter((p) => p.id !== ignoreId).map((p) => p.slug));
  const root = base || "place";
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) if (!taken.has(`${root}-${n}`)) return `${root}-${n}`;
}

function now() {
  return new Date().toISOString();
}

/* Drops empty optional translations so documents stay tidy ({ en: "x", fr: "" } → { en: "x" }). */
function cleanLocalized(value) {
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [lang, text] of Object.entries(value)) if (typeof text === "string" && text.trim() !== "") out[lang] = text.trim();
  return out;
}

function normalizeInput(input) {
  const out = {};
  for (const key of EDITABLE) {
    if (!(key in input)) continue;
    const v = input[key];
    if (key === "name" || key === "country" || key === "description") out[key] = cleanLocalized(v);
    else if (key === "countryCode") out[key] = typeof v === "string" ? v.trim().toUpperCase() : v;
    else out[key] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

function assertValidInput(input, partial) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "invalid_body", "Expected a JSON object.");
  const errors = validatePlaceInput(normalizeInput(input), { partial });
  // Report unknown or server-controlled fields (e.g. ownerId) on the raw input too.
  for (const key of Object.keys(input)) if (!EDITABLE.includes(key)) errors.push({ path: `/${key}`, message: "is not allowed" });
  if (errors.length) throw new ApiError(422, "validation_failed", "Some fields are not valid.", dedupe(errors));
}

function dedupe(errors) {
  const seen = new Set();
  return errors.filter((e) => {
    const k = e.path + "|" + e.message;
    return seen.has(k) ? false : seen.add(k);
  });
}

function findPlace(doc, placeId) {
  const place = doc.places.find((p) => p.id === placeId);
  // Another owner's place id simply does not exist in this owner's document → 404, no information leak.
  if (!place) throw new ApiError(404, "not_found", "Destination not found.");
  return place;
}

function checkVersion(place, expectedVersion) {
  if (expectedVersion === undefined) {
    throw new ApiError(428, "precondition_required", "Send the destination's current version in the If-Match header.");
  }
  if (place.version !== expectedVersion) {
    throw new ApiError(412, "version_conflict", "This destination was changed elsewhere. Reload it and try again.", {
      currentVersion: place.version,
    });
  }
}

export async function listPlaces(store, ownerId) {
  const { data } = await store.getPlaces(ownerId);
  return data.places;
}

export async function createPlace(store, ownerId, input) {
  assertValidInput(input, false);
  const fields = normalizeInput(input);
  return store.mutatePlaces(ownerId, (doc) => {
    const slug = uniqueSlug(fields.slug || slugify(fields.name.en), doc.places);
    const timestamp = now();
    const place = {
      id: `${slug.slice(0, 50)}-${randomSuffix()}`,
      ownerId,
      slug,
      version: 1,
      name: fields.name,
      ...(fields.description && Object.keys(fields.description).length ? { description: fields.description } : {}),
      city: fields.city,
      country: fields.country,
      countryCode: fields.countryCode,
      ...(fields.visitedAt ? { visitedAt: fields.visitedAt } : {}),
      coverMediaId: null,
      media: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    doc.places.unshift(place); // newest first
    return place;
  });
}

export async function updatePlace(store, ownerId, placeId, input, expectedVersion) {
  assertValidInput(input, true);
  const fields = normalizeInput(input);
  return store.mutatePlaces(ownerId, (doc) => {
    const place = findPlace(doc, placeId);
    checkVersion(place, expectedVersion);
    for (const [key, value] of Object.entries(fields)) {
      if (key === "slug") place.slug = uniqueSlug(value, doc.places, place.id);
      else if ((key === "description" && Object.keys(value).length === 0) || (key === "visitedAt" && value === "")) delete place[key];
      else place[key] = value;
    }
    place.version += 1;
    place.updatedAt = now();
    return place;
  });
}

/* ---------- media ---------- */

function touch(place) {
  place.version += 1;
  place.updatedAt = now();
}

function renumber(place) {
  place.media.sort((a, b) => a.position - b.position).forEach((m, i) => (m.position = i));
}

/* Fails fast (before a large upload is read) when the place does not exist or is full. */
export async function assertCanAddMedia(store, ownerId, placeId, max) {
  const { data } = await store.getPlaces(ownerId);
  const place = findPlace(data, placeId);
  if (place.media.length >= max) throw new ApiError(409, "too_many_media", `A destination can hold at most ${max} photos and videos.`);
}

export async function addMedia(store, ownerId, placeId, media) {
  return store.mutatePlaces(ownerId, (doc) => {
    const place = findPlace(doc, placeId);
    place.media.push({ ...media, position: place.media.length });
    if (!place.coverMediaId) place.coverMediaId = media.id; // the first upload becomes the cover
    touch(place);
    return place;
  });
}

/* Attaches (or replaces) a preview variant; returns the place and the replaced file, if any. */
export async function setVariant(store, ownerId, placeId, mediaId, name, variant) {
  let replaced = null;
  const place = await store.mutatePlaces(ownerId, (doc) => {
    const p = findPlace(doc, placeId);
    const m = p.media.find((x) => x.id === mediaId);
    if (!m) throw new ApiError(404, "not_found", "Media not found.");
    replaced = m.variants && m.variants[name] ? m.variants[name].filename : null;
    m.variants = { ...(m.variants || {}), [name]: variant };
    touch(p);
    return p;
  });
  if (replaced && replaced !== variant.filename) await store.deleteMediaFile(ownerId, placeId, replaced);
  return place;
}

/* Fails before reading a preview upload when the media item does not exist. */
export async function assertMediaExists(store, ownerId, placeId, mediaId) {
  const { data } = await store.getPlaces(ownerId);
  const place = findPlace(data, placeId);
  if (!place.media.some((m) => m.id === mediaId)) throw new ApiError(404, "not_found", "Media not found.");
}

export async function removeMedia(store, ownerId, placeId, mediaId) {
  let removed;
  const place = await store.mutatePlaces(ownerId, (doc) => {
    const p = findPlace(doc, placeId);
    removed = p.media.find((m) => m.id === mediaId);
    if (!removed) throw new ApiError(404, "not_found", "Media not found.");
    p.media = p.media.filter((m) => m.id !== mediaId);
    renumber(p);
    if (p.coverMediaId === mediaId) p.coverMediaId = p.media.length ? p.media[0].id : null;
    touch(p);
    return p;
  });
  // Files are deleted only once nothing references them: the original and its previews.
  await store.deleteMediaFile(ownerId, placeId, removed.filename);
  for (const v of Object.values(removed.variants || {})) await store.deleteMediaFile(ownerId, placeId, v.filename);
  return place;
}

export async function reorderMedia(store, ownerId, placeId, order) {
  if (!Array.isArray(order) || order.some((id) => typeof id !== "string"))
    throw new ApiError(422, "validation_failed", "Some fields are not valid.", [{ path: "/order", message: "must be a list of media ids" }]);
  return store.mutatePlaces(ownerId, (doc) => {
    const place = findPlace(doc, placeId);
    const current = place.media.map((m) => m.id).sort();
    const proposed = [...order].sort();
    // The list must be exactly the current media: otherwise the editor is out of date.
    if (current.length !== proposed.length || current.some((id, i) => id !== proposed[i])) {
      throw new ApiError(409, "media_changed", "The media of this destination changed. Reload and try again.", {
        currentOrder: [...place.media].sort((a, b) => a.position - b.position).map((m) => m.id),
      });
    }
    const index = new Map(order.map((id, i) => [id, i]));
    place.media.forEach((m) => (m.position = index.get(m.id)));
    renumber(place);
    touch(place);
    return place;
  });
}

export async function setCover(store, ownerId, placeId, mediaId) {
  if (typeof mediaId !== "string")
    throw new ApiError(422, "validation_failed", "Some fields are not valid.", [{ path: "/mediaId", message: "is required" }]);
  return store.mutatePlaces(ownerId, (doc) => {
    const place = findPlace(doc, placeId);
    if (!place.media.some((m) => m.id === mediaId)) throw new ApiError(404, "not_found", "Media not found.");
    place.coverMediaId = mediaId;
    touch(place);
    return place;
  });
}

export async function deletePlace(store, ownerId, placeId, expectedVersion) {
  const removed = await store.mutatePlaces(ownerId, (doc) => {
    const place = findPlace(doc, placeId);
    checkVersion(place, expectedVersion);
    doc.places = doc.places.filter((p) => p.id !== placeId);
    return place;
  });
  // Files are removed only after the document no longer references them.
  await store.deleteMediaFolder(ownerId, removed.id);
  return removed;
}
