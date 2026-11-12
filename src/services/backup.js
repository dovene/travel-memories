/*
 * Backups from the admin panel.
 *
 * Cloudflare's free plan allows few storage operations and little CPU per request, so the
 * archive is built by the admin's browser, not here:
 *   - export: the browser reads the three content documents from GET /backup/content and
 *     downloads every photo, video and preview from their public URLs, then writes one
 *     .tar file with the same layout as `npm run export` (content/…, media/…, manifest.json);
 *   - restore: the browser reads such a .tar (or an export folder), checks it, asks which
 *     media files are already stored (POST /backup/existing) and uploads the rest one file
 *     per request (PUT /backup/files?path=…), the content documents last.
 *
 * Every restored file is checked here: it must belong to the signed-in owner, JSON
 * documents must pass the schemas, media must be an accepted type whose bytes match.
 */
import { ApiError } from "../utils/responses.js";
import { keys } from "./storage.js";
import { validatePlacesDocument, validateProfile } from "../utils/validation.js";
import { LIMITS, TYPES, compatible, peek, sniff } from "./uploads.js";

const MAX_JSON_BYTES = 5 * 1024 * 1024;
const SEGMENT = "[a-z0-9][a-z0-9-]{0,63}";
const PATHS = {
  username: new RegExp(`^content/usernames/(${SEGMENT})\\.json$`),
  document: new RegExp(`^content/users/(${SEGMENT})/(profile|places)\\.json$`),
  media: new RegExp(`^media/users/(${SEGMENT})/(${SEGMENT})/([A-Za-z0-9][A-Za-z0-9._-]{0,150})$`),
};
const MEDIA_EXTENSIONS = new Set(Object.values(TYPES).flatMap((t) => t.exts));

/* What a backup path is, or an error when it is not one this owner may write. */
export function parseBackupPath(path, session) {
  if (typeof path !== "string" || path.includes("..")) throw new ApiError(400, "invalid_path", "Invalid file path.");
  let m = path.match(PATHS.username);
  if (m) {
    if (m[1] !== session.username) throw new ApiError(403, "not_your_content", "This backup belongs to another journal.");
    return { kind: "username", key: path };
  }
  m = path.match(PATHS.document);
  if (m) {
    if (m[1] !== session.ownerId) throw new ApiError(403, "not_your_content", "This backup belongs to another journal.");
    return { kind: m[2], key: path };
  }
  m = path.match(PATHS.media);
  if (m) {
    if (m[1] !== session.ownerId) throw new ApiError(403, "not_your_content", "This backup belongs to another journal.");
    const ext = m[3].split(".").pop().toLowerCase();
    if (!MEDIA_EXTENSIONS.has(ext)) throw new ApiError(415, "unsupported_media_type", "Unsupported file type.");
    return { kind: "media", key: path };
  }
  throw new ApiError(400, "invalid_path", "This file is not part of a Travel Memories backup.");
}

/* The three content documents, byte for byte, for the browser-built export. */
export async function exportContent(bucket, session, env) {
  const files = [];
  for (const key of [keys.username(session.username), keys.profile(session.ownerId), keys.places(session.ownerId)]) {
    const obj = await bucket.get(key);
    if (obj) files.push({ path: key, contentType: "application/json", text: await obj.text() });
  }
  return { environment: env.ENVIRONMENT || "unknown", ownerId: session.ownerId, username: session.username, exportedAt: new Date().toISOString(), files };
}

/* Which of these media paths are already stored, with their sizes (one listing, not one lookup per file). */
export async function existingMedia(bucket, session, paths) {
  if (!Array.isArray(paths) || paths.length > 20000) throw new ApiError(400, "invalid_body", "Send { paths: [...] }.");
  const wanted = new Set(paths.filter((p) => typeof p === "string"));
  const prefix = `media/users/${session.ownerId}/`;
  const existing = {};
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) if (wanted.has(o.key)) existing[o.key] = o.size;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return existing;
}

function validateDocument(kind, data, session) {
  if (!data || typeof data !== "object") return [{ path: "", message: "is not a JSON object" }];
  if (kind === "username") return data.ownerId === session.ownerId ? [] : [{ path: "/ownerId", message: "does not match your account" }];
  if (data.ownerId !== session.ownerId) return [{ path: "/ownerId", message: "does not match your account" }];
  return kind === "profile" ? validateProfile(data) : validatePlacesDocument(data);
}

/* Writes one restored file (raw request body) after checking it. */
export async function restoreFile(bucket, session, path, request) {
  const target = parseBackupPath(path, session);
  const size = Number(request.headers.get("Content-Length"));
  if (!Number.isInteger(size) || size <= 0) throw new ApiError(411, "length_required", "Content-Length is required.");
  if (!request.body) throw new ApiError(400, "empty_file", "The file is empty.");

  if (target.kind !== "media") {
    if (size > MAX_JSON_BYTES) throw new ApiError(413, "file_too_large", "This document is too large.");
    const text = await request.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(400, "invalid_json", `${path} is not valid JSON.`);
    }
    const errors = validateDocument(target.kind, data, session);
    if (errors.length) throw new ApiError(422, "invalid_content", `${path} is not valid.`, errors);
    await bucket.put(target.key, text, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
    return { path, size: text.length };
  }

  const declared = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!TYPES[declared]) throw new ApiError(415, "unsupported_media_type", "Unsupported file type.");
  if (size > LIMITS.video) throw new ApiError(413, "file_too_large", "This file is too large.");
  const { head, stream } = await peek(request.body, size);
  const detected = sniff(head);
  if (!detected || !compatible(declared, detected)) {
    stream.cancel().catch(() => {});
    throw new ApiError(415, "content_mismatch", `${path}: the content does not match its type.`);
  }
  try {
    await bucket.put(target.key, stream, { httpMetadata: { contentType: declared } });
  } catch (e) {
    console.error("Restore upload failed", { key: target.key, message: e && e.message });
    throw new ApiError(400, "upload_incomplete", "The upload did not complete. Please try again.");
  }
  return { path, size };
}
