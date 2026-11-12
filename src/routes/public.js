/*
 * Public, read-only endpoints. No authentication; owner resolved from the username.
 *   GET /api/public/:username/profile
 *   GET /api/public/:username/places
 *   GET /api/public/:username/places/:slug
 *   GET /api/public/:username/media/:mediaId[?variant=thumb|display|poster]
 *   POST /api/public/:username/visits      page-view beacon (see services/visits.js)
 */
import { ApiError, json, methodNotAllowed, SECURITY_HEADERS } from "../utils/responses.js";
import { ContentStore } from "../services/storage.js";
import { sortPlaces } from "../services/places.js";
import { buildVisit, isBot, storeVisit } from "../services/visits.js";

const MAX_BEACON_BYTES = 2048;

/* Page-view beacon: answers 204 at once; the visit is stored in the background. */
async function visitBeacon(request, env, ownerId, ctx, getSession) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) throw new ApiError(403, "forbidden_origin", "Cross-site requests are not allowed.");
  const done = new Response(null, { status: 204, headers: { "Cache-Control": "no-store", ...SECURITY_HEADERS } });
  if (isBot(request.headers.get("User-Agent"))) return done;
  if (getSession && (await getSession(request, env))) return done; // the owner's own visits are not counted
  const text = await request.text();
  if (text.length > MAX_BEACON_BYTES) return done;
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    return done;
  }
  const built = await buildVisit(env, request, body);
  if (!built) return done;
  const job = storeVisit(env.STORAGE, ownerId, built.day, built.visit).catch((e) => console.error("Visit not stored", { message: e && e.message }));
  if (ctx && ctx.waitUntil) ctx.waitUntil(job);
  else await job;
  return done;
}

/* Media URLs are generated, never stored, so content stays independent of the hosting provider. */
export function mediaBaseUrl(env, username) {
  const template = env.MEDIA_BASE_URL || "/api/public/{username}/media";
  return template.replace("{username}", encodeURIComponent(username)).replace(/\/$/, "");
}

/*
 * Visitors never see file names: for the public site (`isPublic`), stored and original file
 * names are left out and the alt text (which defaults to the file name) becomes
 * "<destination name> · <position>". The admin keeps everything.
 */
export function presentPlace(place, base, { isPublic = false } = {}) {
  const media = [...place.media]
    .sort((a, b) => a.position - b.position)
    .map((m, i) => {
      const url = `${base}/${encodeURIComponent(m.id)}`;
      const variants = {};
      for (const [name, v] of Object.entries(m.variants || {})) {
        // The token in the stored name changes when a preview is regenerated, so the URL does too.
        const token = (v.filename.match(/-([a-z0-9]+)\.[a-z]+$/) || [])[1] || "1";
        variants[name] = { ...v, url: `${url}?variant=${name}&v=${token}` };
        if (isPublic) delete variants[name].filename;
      }
      if (!isPublic) return { ...m, url, variants };
      const { filename, originalFilename, altText, ...rest } = m;
      const alt = {};
      for (const [lang, name] of Object.entries(place.name || {})) if (name) alt[lang] = `${name} · ${i + 1}`;
      return { ...rest, altText: alt, url, variants };
    });
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

async function serveMedia(request, store, ownerId, mediaId, variantName) {
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

  // Previews fall back to the original for photos; a missing video poster is simply absent.
  let file = { filename: found.media.filename, contentType: found.media.contentType };
  if (variantName) {
    const v = found.media.variants && found.media.variants[variantName];
    if (v) file = v;
    else if (found.media.type === "video" || !["thumb", "display", "poster"].includes(variantName))
      throw new ApiError(404, "not_found", "Preview not found.");
  }

  const object = await store.getMediaObject(ownerId, found.place.id, file.filename, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!object) throw new ApiError(404, "not_found", "Media file is missing.");

  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Type", file.contentType); // from validated metadata, not from the file
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

export async function handlePublic(request, env, segments, ctx, getSession) {
  // segments: [username, resource, id?]
  const [username, resource, id, extra] = segments;
  const beacon = resource === "visits" && id === undefined;
  if (beacon ? request.method !== "POST" : request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(beacon ? ["POST"] : ["GET", "HEAD"]);
  if (!username || !resource || extra !== undefined) throw new ApiError(404, "not_found", "Resource not found.");

  const store = new ContentStore(env.STORAGE);
  const ownerId = await store.resolveUsername(username);
  if (!ownerId) throw new ApiError(404, "not_found", "Journal not found.");
  if (beacon) return visitBeacon(request, env, ownerId, ctx, getSession);

  if (resource === "profile" && id === undefined) {
    const profile = await store.getProfile(ownerId);
    if (!profile) throw new ApiError(404, "not_found", "Journal not found.");
    return cachedJson(request, presentProfile(profile.data), profile.etag);
  }

  if (resource === "places") {
    const { data, etag } = await store.getPlaces(ownerId);
    const base = mediaBaseUrl(env, username);
    const tag = etag && `${etag}-p2`; // bump the suffix whenever the public shape changes, so cached copies refresh
    if (id === undefined) return cachedJson(request, { places: sortPlaces(data.places).map((p) => presentPlace(p, base, { isPublic: true })) }, tag);
    const place = data.places.find((p) => p.slug === id);
    if (!place) throw new ApiError(404, "not_found", "Destination not found.");
    return cachedJson(request, presentPlace(place, base, { isPublic: true }), tag && `${tag}-${place.id}`);
  }

  if (resource === "media" && id !== undefined) return serveMedia(request, store, ownerId, id, new URL(request.url).searchParams.get("variant"));

  throw new ApiError(404, "not_found", "Resource not found.");
}
