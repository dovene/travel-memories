/*
 * In-memory stand-in for an R2 bucket binding, covering what the app uses:
 * get (range + onlyIf), head, put (onlyIf etagMatches / etagDoesNotMatch "*"), delete, list.
 * The conditional semantics mirror Wrangler's local R2 (checked with getPlatformProxy):
 * a failed put precondition returns null.
 */
import { createHash } from "node:crypto";

function toBytes(value) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error("Unsupported value type in fake R2");
}

function header(h, name) {
  return h instanceof Headers ? h.get(name) : null;
}

export class FakeR2 {
  constructor() {
    this.objects = new Map();
    this.beforePut = null; // test hook: async (key) => void, runs before each put
  }

  _meta(key, o) {
    return { key, size: o.bytes.length, etag: o.etag, httpEtag: `"${o.etag}"`, uploaded: o.uploaded, httpMetadata: o.httpMetadata };
  }

  async head(key) {
    const o = this.objects.get(key);
    return o ? this._meta(key, o) : null;
  }

  async get(key, options = {}) {
    const o = this.objects.get(key);
    if (!o) return null;
    const meta = this._meta(key, o);
    const inm = header(options.onlyIf, "If-None-Match");
    if (inm && inm.replace(/"/g, "") === o.etag) return meta; // no body: precondition failed
    let bytes = o.bytes;
    const range = header(options.range, "Range");
    if (range) {
      const m = range.match(/^bytes=(\d+)-(\d*)$/);
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), bytes.length - 1) : bytes.length - 1;
      bytes = bytes.slice(start, end + 1);
      meta.range = { offset: start, length: bytes.length };
    }
    return {
      ...meta,
      body: new Blob([bytes]).stream(),
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  }

  async put(key, value, options = {}) {
    if (this.beforePut) await this.beforePut(key);
    const existing = this.objects.get(key);
    const c = options.onlyIf || {};
    if (c.etagMatches !== undefined && (!existing || existing.etag !== c.etagMatches)) return null;
    if (c.etagDoesNotMatch === "*" && existing) return null;
    const bytes = toBytes(value);
    const etag = createHash("md5").update(bytes).update(String(Math.random())).digest("hex");
    const o = { bytes, etag, uploaded: new Date(), httpMetadata: options.httpMetadata || {} };
    this.objects.set(key, o);
    return this._meta(key, o);
  }

  async delete(keys) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }

  async list({ prefix = "", cursor, limit = 1000 } = {}) {
    const all = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const page = all.slice(start, start + limit);
    const truncated = start + limit < all.length;
    return { objects: page.map((k) => ({ key: k })), truncated, cursor: truncated ? String(start + limit) : undefined };
  }

  /* Test helpers */
  json(key) {
    const o = this.objects.get(key);
    return o ? JSON.parse(new TextDecoder().decode(o.bytes)) : null;
  }

  putJsonSync(key, data) {
    const bytes = toBytes(JSON.stringify(data));
    this.objects.set(key, { bytes, etag: createHash("md5").update(bytes).digest("hex"), uploaded: new Date(), httpMetadata: {} });
  }
}
