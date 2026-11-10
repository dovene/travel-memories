/*
 * Administration endpoints. Every data route needs a valid session cookie; the owner is
 * always taken from the session, never from the request.
 *
 *   POST   /api/admin/login                       { username, password }  (rate limited)
 *   POST   /api/admin/logout
 *   GET    /api/admin/session
 *   GET    /api/admin/places
 *   POST   /api/admin/places
 *   GET    /api/admin/places/:id
 *   PUT    /api/admin/places/:id                  If-Match: "<version>"
 *   DELETE /api/admin/places/:id                  If-Match: "<version>"
 *   POST   /api/admin/places/:id/media            raw file body (see services/uploads.js)
 *   DELETE /api/admin/places/:id/media/:mediaId
 *   PUT    /api/admin/places/:id/media/order      { order: [mediaId, ...] }
 *   PUT    /api/admin/places/:id/media/cover      { mediaId }
 *   PUT    /api/admin/places/:id/media/:mediaId/variants/:name   preview image (thumb|display|poster)
 */
import { ApiError, json, methodNotAllowed, SECURITY_HEADERS } from "../utils/responses.js";
import { ContentStore } from "../services/storage.js";
import {
  addMedia, assertCanAddMedia, assertMediaExists, createPlace, deletePlace, listPlaces, removeMedia, reorderMedia, setCover,
  setVariant, updatePlace,
} from "../services/places.js";
import { authenticate, clearedSessionCookie, createSessionToken, isConfigured, sessionCookie } from "../services/auth.js";
import { MAX_MEDIA_PER_PLACE, storeUpload, storeVariant } from "../services/uploads.js";
import { mediaBaseUrl, presentPlace } from "./public.js";

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

/*
 * CSRF defence for cookie-authenticated requests: every state-changing request must carry
 * an Origin header equal to this site (browsers always send it on POST/PUT/DELETE fetches).
 * Together with SameSite=Strict cookies this blocks cross-site form and fetch attacks.
 */
function requireSameOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("Origin");
  if (origin !== new URL(request.url).origin) throw new ApiError(403, "forbidden_origin", "Cross-site requests are not allowed.");
}

async function login(request, env) {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  requireSameOrigin(request);
  if (!isConfigured(env)) throw new ApiError(503, "auth_not_configured", "Sign-in is not configured on this environment yet.");

  if (env.LOGIN_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.LOGIN_LIMITER.limit({ key: `login:${ip}` });
    if (!success) {
      return json({ error: { code: "too_many_attempts", message: "Too many sign-in attempts. Wait a minute and try again." } }, 429, { "Retry-After": "60" });
    }
  }

  const body = await readJsonBody(request);
  const account = await authenticate(env, body && body.username, body && body.password);
  if (!account) throw new ApiError(401, "invalid_credentials", "Incorrect username or password.");

  const token = await createSessionToken(env, account);
  return json({ authenticated: true, ownerId: account.ownerId, username: account.username }, 200, { "Set-Cookie": sessionCookie(token) });
}

function logout(request) {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  requireSameOrigin(request);
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedSessionCookie(), ...SECURITY_HEADERS } });
}

export async function handleAdmin(request, env, segments, { getSession }) {
  const [resource, id, sub, subId, extra, variantName, beyond] = segments;

  if (resource === "login" && id === undefined) return login(request, env);
  if (resource === "logout" && id === undefined) return logout(request);

  const session = await getSession(request, env);
  if (resource === "session" && id === undefined) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    return json(session ? { authenticated: true, ownerId: session.ownerId, username: session.username } : { authenticated: false });
  }

  if (!session) throw new ApiError(401, "unauthorized", "Sign in to continue.");
  requireSameOrigin(request);
  if (resource !== "places" || beyond !== undefined) throw new ApiError(404, "not_found", "Resource not found.");

  const ownerId = session.ownerId;
  const store = new ContentStore(env.STORAGE);
  const base = mediaBaseUrl(env, session.username);
  const present = (place) => presentPlace(place, base);
  const placeResponse = (place, status = 200, headers = {}) => json(present(place), status, { ETag: etagFor(place), ...headers });

  /* /places */
  if (id === undefined) {
    if (request.method === "GET") return json({ places: (await listPlaces(store, ownerId)).map(present) });
    if (request.method === "POST") {
      const place = await createPlace(store, ownerId, await readJsonBody(request));
      return placeResponse(place, 201, { Location: `/api/admin/places/${place.id}` });
    }
    return methodNotAllowed(["GET", "POST"]);
  }

  /* /places/:id */
  if (sub === undefined) {
    if (request.method === "GET") {
      const place = (await listPlaces(store, ownerId)).find((p) => p.id === id);
      if (!place) throw new ApiError(404, "not_found", "Destination not found.");
      return placeResponse(place);
    }
    if (request.method === "PUT") {
      const expected = parseIfMatch(request);
      return placeResponse(await updatePlace(store, ownerId, id, await readJsonBody(request), expected));
    }
    if (request.method === "DELETE") {
      await deletePlace(store, ownerId, id, parseIfMatch(request));
      return new Response(null, { status: 204, headers: SECURITY_HEADERS });
    }
    return methodNotAllowed(["GET", "PUT", "DELETE"]);
  }

  if (sub !== "media") throw new ApiError(404, "not_found", "Resource not found.");

  /* /places/:id/media */
  if (subId === undefined) {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    await assertCanAddMedia(store, ownerId, id, MAX_MEDIA_PER_PLACE); // ownership checked before reading the file
    const { key, media } = await storeUpload(env.STORAGE, ownerId, id, request);
    try {
      return placeResponse(await addMedia(store, ownerId, id, media), 201);
    } catch (e) {
      await env.STORAGE.delete(key).catch(() => {}); // do not leave an unreferenced file behind
      throw e;
    }
  }

  /* /places/:id/media/order and /cover */
  if (subId === "order" || subId === "cover") {
    if (request.method !== "PUT") return methodNotAllowed(["PUT"]);
    const body = await readJsonBody(request);
    const place = subId === "order"
      ? await reorderMedia(store, ownerId, id, body && body.order)
      : await setCover(store, ownerId, id, body && body.mediaId);
    return placeResponse(place);
  }

  /* /places/:id/media/:mediaId/variants/:name */
  if (extra !== undefined) {
    if (extra !== "variants" || variantName === undefined) throw new ApiError(404, "not_found", "Resource not found.");
    if (request.method !== "PUT") return methodNotAllowed(["PUT"]);
    await assertMediaExists(store, ownerId, id, subId);
    const { key, variant } = await storeVariant(env.STORAGE, ownerId, id, subId, variantName, request);
    try {
      return placeResponse(await setVariant(store, ownerId, id, subId, variantName, variant));
    } catch (e) {
      await env.STORAGE.delete(key).catch(() => {});
      throw e;
    }
  }

  /* /places/:id/media/:mediaId */
  if (request.method !== "DELETE") return methodNotAllowed(["DELETE"]);
  return placeResponse(await removeMedia(store, ownerId, id, subId));
}
