/*
 * Public, read-only endpoints. No authentication; owner resolved from the username.
 *   GET /api/public/:username/profile
 *   GET /api/public/:username/places
 *   GET /api/public/:username/places/:slug
 *   GET /api/public/:username/media/:mediaId
 */
import { ApiError, json, methodNotAllowed, SECURITY_HEADERS } from "../utils/responses.js";
import { ContentStore } from "../services/storage.js";

/* Media URLs are generated, never stored, so content stays independent of the hosting provider. */
export function mediaBaseUrl(env, username) {
  const template = env.MEDIA_BASE_URL || "/api/public/{username}/media";
  return template.replace("{username}", encodeURIComponent(username)).replace(/\/$/, "");
}

export function presentPlace(place, base) {
  const media = [...place.media]
    .sort((a, b) => a.position - b.position)
    .map((m) => ({ ...m, url: `${base}/${encodeURIComponent(m.id)}` }));
  return { ...place, media };
}

function presentProfile(profile) {
  const { schemaVersion, ownerId, username, displayName, description } = profile;
  return { schemaVersion, ownerId, username, displayName, ...(description ? { description } : {}) };
}

/* JSON reads are revalidated with the document ETag so browsers get cheap 304s. */
function cachedJson(request, data, etag) {
  const headers = { "Cache-Control": "public, max-age=0, must-revalidate" };
  if (etag) {
    const tag = `"${etag}"`;
    headers.ETag = tag;
    if (request.headers.get("If-None-Match") === tag) return new Response(null, { status: 304, headers: { ...headers, ...SECURITY_HEADERS } });
  }
  return json(data, 200, headers);
}

async function serveMedia(request, store, ownerId, mediaId) {
  const { data } = await store.getPlaces(ownerId);
  let found = null;
  for (const place of data.places) {
    const m = place.media.find((x) => x.id === mediaId);
    if (m) {
      found = { place, media: m };
      break;
    }
  }
  if (!found) throw new ApiError(404, "not_found", "Media not found.");

  const object = await store.getMediaObject(ownerId, found.place.id, found.media.filename, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!object) throw new ApiError(404, "not_found", "Media file is missing.");

  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Type", found.media.contentType); // from validated metadata, not from the file
  headers.set("Cache-Control", "public, max-age=31536000, immutable"); // media ids never point to different bytes
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Disposition", "inline");

  if (!("body" in object) || !object.body) return new Response(null, { status: 304, headers }); // If-None-Match matched

  if (object.range && request.headers.has("Range")) {
    const { offset = 0, length = object.size - offset } = object.range;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

export async function handlePublic(request, env, segments) {
  // segments: [username, resource, id?]
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
  const [username, resource, id, extra] = segments;
  if (!username || !resource || extra !== undefined) throw new ApiError(404, "not_found", "Resource not found.");

  const store = new ContentStore(env.STORAGE);
  const ownerId = await store.resolveUsername(username);
  if (!ownerId) throw new ApiError(404, "not_found", "Journal not found.");

  if (resource === "profile" && id === undefined) {
    const profile = await store.getProfile(ownerId);
    if (!profile) throw new ApiError(404, "not_found", "Journal not found.");
    return cachedJson(request, presentProfile(profile.data), profile.etag);
  }

  if (resource === "places") {
    const { data, etag } = await store.getPlaces(ownerId);
    const base = mediaBaseUrl(env, username);
    if (id === undefined) return cachedJson(request, { places: data.places.map((p) => presentPlace(p, base)) }, etag);
    const place = data.places.find((p) => p.slug === id);
    if (!place) throw new ApiError(404, "not_found", "Destination not found.");
    return cachedJson(request, presentPlace(place, base), etag && `${etag}-${place.id}`);
  }

  if (resource === "media" && id !== undefined) return serveMedia(request, store, ownerId, id);

  throw new ApiError(404, "not_found", "Resource not found.");
}
