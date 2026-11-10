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
