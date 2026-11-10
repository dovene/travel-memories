/*
 * Administrator authentication — independent of content storage.
 *
 * Accounts (one for now) come from configuration, so adding more owners later only
 * means changing where accounts are looked up:
 *   ADMIN_USERNAME, ADMIN_OWNER_ID   vars in wrangler.toml
 *   ADMIN_PASSWORD_HASH              secret: "pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>"
 *   SESSION_SECRET                   secret: random key that signs session cookies
 *
 * Sessions are stateless, HMAC-signed cookies (HttpOnly, Secure, SameSite=Strict) that expire.
 */

export const SESSION_COOKIE = "__Host-tm_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PBKDF2_ITERATIONS = 100_000; // Workers' Web Crypto maximum for PBKDF2
const encoder = new TextEncoder();

/* ---------- encoding ---------- */

function toBase64Url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/* Constant-time comparison so timing does not reveal how much of a secret matched. */
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ---------- passwords ---------- */

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

/* A well-formed decoy so a wrong username costs the same time as a wrong password. */
const DECOY_HASH = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > PBKDF2_ITERATIONS) return false;
  const actual = await pbkdf2(String(password), fromBase64Url(parts[2]), iterations);
  return equalBytes(actual, fromBase64Url(parts[3]));
}

/* ---------- accounts ---------- */

export function isConfigured(env) {
  return Boolean(env.ADMIN_USERNAME && env.ADMIN_OWNER_ID && env.ADMIN_PASSWORD_HASH && env.SESSION_SECRET && env.SESSION_SECRET.length >= 32);
}

/* Returns { ownerId, username } for valid credentials, otherwise null. */
export async function authenticate(env, username, password) {
  const name = String(username || "").trim().toLowerCase();
  const known = name === String(env.ADMIN_USERNAME).toLowerCase();
  const ok = await verifyPassword(password, known ? env.ADMIN_PASSWORD_HASH : DECOY_HASH);
  return known && ok ? { ownerId: env.ADMIN_OWNER_ID, username: env.ADMIN_USERNAME } : null;
}

/* ---------- session cookies ---------- */

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSessionToken(env, { ownerId, username }, now = Date.now()) {
  const payload = { sub: ownerId, usr: username, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env.SESSION_SECRET), encoder.encode(body)));
  return `${body}.${toBase64Url(sig)}`;
}

export async function readSessionToken(env, token, now = Date.now()) {
  if (!token || !env.SESSION_SECRET) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", await hmacKey(env.SESSION_SECRET), fromBase64Url(sig), encoder.encode(body));
  } catch {
    return null;
  }
  if (!valid) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(now / 1000)) return null;
  // The session must still belong to a configured account (rotating accounts logs people out).
  if (payload.sub !== env.ADMIN_OWNER_ID) return null;
  return { ownerId: payload.sub, username: payload.usr, expiresAt: payload.exp };
}

export function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

/* The authentication boundary used by every admin route: { ownerId, username } or null. */
export async function getSession(request, env) {
  return readSessionToken(env, readCookie(request, SESSION_COOKIE));
}
