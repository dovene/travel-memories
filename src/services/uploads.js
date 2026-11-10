/*
 * Media uploads, proxied through the Worker to R2 (MVP approach from the spec).
 *
 * The browser sends the raw file as the request body with:
 *   Content-Type     the file's MIME type
 *   Content-Length   required (also the upload size limit check)
 *   X-Filename       original file name, URI-encoded
 *   X-Media-Width / X-Media-Height   optional pixel size measured by the browser
 *
 * Server-side checks: authorization and ownership (by the caller), allowed extension,
 * declared type, the file's actual signature ("magic bytes"), and size. The body is
 * streamed to R2 — never fully buffered — and the stored type is the detected one.
 */
import { ApiError } from "../utils/responses.js";
import { keys } from "./storage.js";

/* Cloudflare's request body limit on the free plan is 100 MB; keep headroom. */
export const LIMITS = {
  image: 25 * 1024 * 1024,
  video: 95 * 1024 * 1024,
};
export const MAX_MEDIA_PER_PLACE = 500;

const TYPES = {
  "image/jpeg": { kind: "image", ext: "jpg", exts: ["jpg", "jpeg"] },
  "image/png": { kind: "image", ext: "png", exts: ["png"] },
  "image/webp": { kind: "image", ext: "webp", exts: ["webp"] },
  "image/heic": { kind: "image", ext: "heic", exts: ["heic", "heif"] },
  "image/avif": { kind: "image", ext: "avif", exts: ["avif"] },
  "video/mp4": { kind: "video", ext: "mp4", exts: ["mp4", "m4v"] },
  "video/quicktime": { kind: "video", ext: "mov", exts: ["mov"] },
  "video/webm": { kind: "video", ext: "webm", exts: ["webm"] },
};

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.slice(from, to));

/* Detects the real format from the first bytes. Returns a MIME type or null. */
export function sniff(head) {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b)) return "image/png";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "image/webp";
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return "image/heic";
    if (["avif", "avis"].includes(brand)) return "image/avif";
    if (brand === "mif1" || brand === "msf1") return "image/heic";
    if (brand === "qt  ") return "video/quicktime";
    if (["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VP", "dash", "mmp4", "f4v "].includes(brand)) return "video/mp4";
  }
  return null;
}

/* Families that may legitimately be declared one way and detected another (e.g. .mov holding MP4). */
function compatible(declared, detected) {
  if (declared === detected) return true;
  const pair = new Set([declared, detected]);
  return (pair.has("video/mp4") && pair.has("video/quicktime")) || (pair.has("image/heic") && pair.has("image/avif"));
}

function randomId(prefix) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `${prefix}-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

function intHeader(request, name) {
  const v = request.headers.get(name);
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 100_000 ? n : undefined;
}

/* Validates headers before any byte is read. */
export function inspectUploadRequest(request) {
  const declared = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const type = TYPES[declared];
  if (!type) throw new ApiError(415, "unsupported_media_type", "Only JPG, PNG, WEBP, HEIC, AVIF images and MP4, MOV, WEBM videos are accepted.");

  let originalFilename = "";
  try {
    originalFilename = decodeURIComponent(request.headers.get("X-Filename") || "").slice(0, 255);
  } catch {
    throw new ApiError(400, "invalid_filename", "X-Filename must be URI-encoded.");
  }
  const ext = (originalFilename.split(".").pop() || "").toLowerCase();
  if (!originalFilename.includes(".") || !type.exts.includes(ext))
    throw new ApiError(415, "extension_mismatch", `The file extension does not match ${declared}.`);

  const lengthHeader = request.headers.get("Content-Length");
  if (lengthHeader === null) throw new ApiError(411, "length_required", "Content-Length is required.");
  const size = Number(lengthHeader);
  if (!Number.isInteger(size) || size <= 0) throw new ApiError(400, "empty_file", "The file is empty.");
  if (size > LIMITS[type.kind]) {
    throw new ApiError(413, "file_too_large", `${type.kind === "image" ? "Photos" : "Videos"} can be at most ${LIMITS[type.kind] / 1024 / 1024} MB.`);
  }
  if (!request.body) throw new ApiError(400, "empty_file", "The file is empty.");

  return { declared, kind: type.kind, size, originalFilename, width: intHeader(request, "X-Media-Width"), height: intHeader(request, "X-Media-Height") };
}

/*
 * Reads the first bytes for sniffing, then returns a stream that replays them followed by
 * the rest of the body, with an exact length (R2 needs a known length for streamed puts).
 */
async function peek(body, size, want = 32) {
  const reader = body.getReader();
  const chunks = [];
  let have = 0;
  while (have < want) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    have += value.length;
  }
  const head = new Uint8Array(have);
  let o = 0;
  for (const c of chunks) {
    head.set(c, o);
    o += c.length;
  }
  const { readable, writable } = new FixedLengthStream(size);
  (async () => {
    const writer = writable.getWriter();
    try {
      await writer.write(head);
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.close();
    } catch (e) {
      await writer.abort(e).catch(() => {});
    }
  })();
  return { head, stream: readable };
}

/*
 * Stores the upload under media/users/<ownerId>/<placeId>/<mediaId>.<ext> and returns the
 * media item to add to the place. The caller has already checked ownership of the place.
 */
export async function storeUpload(bucket, ownerId, placeId, request) {
  const info = inspectUploadRequest(request);
  const { head, stream } = await peek(request.body, info.size);
  const detected = sniff(head);
  if (!detected || !compatible(info.declared, detected)) {
    stream.cancel().catch(() => {});
    throw new ApiError(415, "content_mismatch", "The file content does not match its type.");
  }
  const id = randomId(info.kind === "image" ? "img" : "vid");
  const filename = `${id}.${TYPES[detected].ext}`;
  const key = keys.media(ownerId, placeId, filename);
  try {
    await bucket.put(key, stream, { httpMetadata: { contentType: detected } });
  } catch (e) {
    console.error("Upload failed", { key, message: e && e.message });
    throw new ApiError(400, "upload_incomplete", "The upload did not complete. Please try again.");
  }
  return {
    key,
    media: {
      id,
      type: info.kind,
      filename,
      originalFilename: info.originalFilename,
      contentType: detected,
      size: info.size,
      ...(info.width && info.height ? { width: info.width, height: info.height } : {}),
      altText: { en: info.originalFilename.replace(/\.[^.]+$/, "").slice(0, 300) },
      uploadedAt: new Date().toISOString(),
    },
  };
}
