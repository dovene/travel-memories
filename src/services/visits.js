/*
 * Visitor statistics, stored as one JSON file per day:
 *   visits/users/<ownerId>/<yyyy-mm-dd>.json   { schemaVersion, ownerId, date, visits: [...] }
 *
 * Each page view of the public site sends one small beacon. What is kept per visit:
 *   t   time (ISO, UTC)                     p   page: "home" | "place"
 *   s   destination slug (place pages)      l   site language
 *   ci, rg, cc   city, region and country code, from Cloudflare's network location
 *   dv  device: "mobile" | "tablet" | "desktop"
 *   rf  the site the visitor came from (host name only), when not this site
 *   v   an anonymous visitor id: a keyed hash of IP + browser that changes every day,
 *       so unique visitors can be counted without storing IP addresses
 *
 * Not recorded: IP addresses, the owner's own visits (signed-in sessions), and obvious bots.
 * Writes are conditional (ETag) and retried; logging is best effort and never blocks a page.
 */
import { ApiError } from "../utils/responses.js";

export const MAX_VISITS_PER_DAY = 20000;
export const MAX_RANGE_DAYS = 31;
const MAX_ATTEMPTS = 4;

export const visitKey = (ownerId, day) => `visits/users/${ownerId}/${day}.json`;

const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|go-http|node-fetch|axios|java\//i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isBot(userAgent) {
  return !userAgent || BOTS.test(userAgent);
}

export function deviceOf(ua) {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return "mobile";
  return "desktop";
}

const clean = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);

function referrerHost(ref, ownHost) {
  if (typeof ref !== "string" || !ref) return undefined;
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    return host && host !== ownHost ? host.slice(0, 100) : undefined;
  } catch {
    return undefined;
  }
}

async function visitorId(secret, day, ip, ua) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(`visits:${secret || "local"}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${day}|${ip}|${ua}`)));
  return Array.from(sig.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* Builds the stored record from the beacon body and the request; null when the body is not acceptable. */
export async function buildVisit(env, request, body, now = new Date()) {
  if (!body || typeof body !== "object" || !["home", "place"].includes(body.page)) return null;
  const slug = body.page === "place" && typeof body.slug === "string" && SLUG.test(body.slug) ? body.slug : undefined;
  if (body.page === "place" && !slug) return null;
  const ua = request.headers.get("User-Agent") || "";
  const cf = request.cf || {};
  const day = now.toISOString().slice(0, 10);
  const country = typeof cf.country === "string" && /^[A-Z]{2}$/.test(cf.country) ? cf.country : undefined;
  const visit = {
    t: now.toISOString(),
    p: body.page,
    s: slug,
    l: body.lang === "fr" ? "fr" : "en",
    ci: clean(cf.city, 80),
    rg: clean(cf.region, 80),
    cc: country,
    dv: deviceOf(ua),
    rf: referrerHost(body.ref, new URL(request.url).hostname.replace(/^www\./, "")),
    v: await visitorId(env.SESSION_SECRET, day, request.headers.get("CF-Connecting-IP") || "", ua),
  };
  for (const k of Object.keys(visit)) if (visit[k] === undefined) delete visit[k];
  return { day, visit };
}

/* Appends a visit to the day's file. Returns true when stored. */
export async function storeVisit(bucket, ownerId, day, visit) {
  const key = visitKey(ownerId, day);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const obj = await bucket.get(key);
    let doc = { schemaVersion: 1, ownerId, date: day, visits: [] };
    if (obj) {
      try {
        doc = JSON.parse(await obj.text());
      } catch {
        console.error("Corrupt visits file", { key });
        return false;
      }
    }
    if (doc.visits.length >= MAX_VISITS_PER_DAY) return false;
    doc.visits.push(visit);
    const res = await bucket.put(key, JSON.stringify(doc), {
      onlyIf: obj ? { etagMatches: obj.etag } : { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
    if (res !== null) return true;
  }
  return false;
}

/* Days from `from` to `to` inclusive (yyyy-mm-dd), at most MAX_RANGE_DAYS. */
export function daysBetween(from, to) {
  if (!DAY.test(from || "") || !DAY.test(to || "")) throw new ApiError(400, "invalid_range", "from and to must be dates (yyyy-mm-dd).");
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) throw new ApiError(400, "invalid_range", "Invalid date range.");
  const count = Math.round((end - start) / 86400000) + 1;
  if (count > MAX_RANGE_DAYS) throw new ApiError(400, "range_too_long", `Ask for at most ${MAX_RANGE_DAYS} days at a time.`);
  return Array.from({ length: count }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
}

export async function readVisits(bucket, ownerId, from, to) {
  const days = daysBetween(from, to);
  const docs = await Promise.all(
    days.map(async (day) => {
      const obj = await bucket.get(visitKey(ownerId, day));
      if (!obj) return [];
      try {
        return JSON.parse(await obj.text()).visits || [];
      } catch {
        return [];
      }
    })
  );
  return docs.flat();
}
