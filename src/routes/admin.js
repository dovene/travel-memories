/*
 * Administration endpoints. Every request needs an authenticated session; the owner is
 * always taken from that session.
 *   GET    /api/admin/session
 *   GET    /api/admin/places
 *   POST   /api/admin/places
 *   GET    /api/admin/places/:id
 *   PUT    /api/admin/places/:id          (If-Match: "<version>")
 *   DELETE /api/admin/places/:id          (If-Match: "<version>")
 * Login/logout and media upload, order and cover arrive in Phase 3 (501 until then).
 */
import { ApiError, json, methodNotAllowed } from "../utils/responses.js";
import { ContentStore } from "../services/storage.js";
import { createPlace, deletePlace, listPlaces, updatePlace } from "../services/places.js";

const MAX_BODY_BYTES = 64 * 1024;

function etagFor(place) {
  return `"${place.version}"`;
}

/* If-Match: "3", W/"3" or 3 → 3. Missing → undefined (the service answers 428). */
export function parseIfMatch(request) {
  const raw = request.headers.get("If-Match");
  if (raw === null) return undefined;
  const m = raw.trim().match(/^(?:W\/)?"?(\d{1,9})"?$/);
  if (!m) throw new ApiError(400, "invalid_if_match", 'If-Match must be the destination version, e.g. "3".');
  return Number(m[1]);
}

async function readJsonBody(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().startsWith("application/json")) throw new ApiError(415, "unsupported_media_type", "Send JSON (Content-Type: application/json).");
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "body_too_large", "Request body is too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, "body_too_large", "Request body is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

/* Basic CSRF defence: state-changing requests from a browser must come from this site. */
function checkOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "forbidden_origin", "Cross-site requests are not allowed.");
}

export async function handleAdmin(request, env, segments, { getSession }) {
  const [resource, id, sub] = segments;
  const session = await getSession(request, env);

  if (resource === "session" && id === undefined) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    return json(session ? { authenticated: true, ownerId: session.ownerId } : { authenticated: false });
  }
  if (resource === "login" || resource === "logout") throw new ApiError(501, "not_implemented", "Login arrives in Phase 3.");

  if (!session) throw new ApiError(401, "unauthorized", "Sign in to continue.");
  checkOrigin(request);
  const ownerId = session.ownerId;

  if (resource !== "places") throw new ApiError(404, "not_found", "Resource not found.");
  if (sub !== undefined) throw new ApiError(501, "not_implemented", "Media management arrives in Phase 3.");

  const store = new ContentStore(env.STORAGE);

  if (id === undefined) {
    if (request.method === "GET") return json({ places: await listPlaces(store, ownerId) });
    if (request.method === "POST") {
      const place = await createPlace(store, ownerId, await readJsonBody(request));
      return json(place, 201, { ETag: etagFor(place), Location: `/api/admin/places/${place.id}` });
    }
    return methodNotAllowed(["GET", "POST"]);
  }

  if (request.method === "GET") {
    const place = (await listPlaces(store, ownerId)).find((p) => p.id === id);
    if (!place) throw new ApiError(404, "not_found", "Destination not found.");
    return json(place, 200, { ETag: etagFor(place) });
  }
  if (request.method === "PUT") {
    const expected = parseIfMatch(request);
    const place = await updatePlace(store, ownerId, id, await readJsonBody(request), expected);
    return json(place, 200, { ETag: etagFor(place) });
  }
  if (request.method === "DELETE") {
    await deletePlace(store, ownerId, id, parseIfMatch(request));
    return new Response(null, { status: 204 });
  }
  return methodNotAllowed(["GET", "PUT", "DELETE"]);
}
