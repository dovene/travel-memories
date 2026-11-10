/*
 * Travel Memories Worker entry point.
 *
 * Static files in public/ are served by Workers Static Assets. Only /api/* and /admin*
 * requests run this code first (see `run_worker_first` in wrangler.toml):
 *   - /api/*   → API router
 *   - /admin*  → the admin pages are only served to signed-in users; others are sent
 *                to the login page. (The data itself is protected by the API either way.)
 *
 * Note: the Workers runtime only accepts handlers as exports of this module,
 * so constants and helpers live in other modules.
 */
import { handleApi } from "./routes/api.js";
import { getSession } from "./services/auth.js";
import { error, SECURITY_HEADERS } from "./utils/responses.js";

const LOGIN_PATHS = new Set(["/admin/login", "/admin/login.html"]);

function redirect(url, location) {
  return new Response(null, { status: 302, headers: { Location: new URL(location, url).toString(), "Cache-Control": "no-store", ...SECURITY_HEADERS } });
}

async function guardAdminPage(request, env) {
  const url = new URL(request.url);
  const session = await getSession(request, env);
  if (LOGIN_PATHS.has(url.pathname)) return session ? redirect(url, "/admin/") : null;
  return session ? null : redirect(url, "/admin/login");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, ctx);
      }
      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
        const blocked = await guardAdminPage(request, env);
        if (blocked) return blocked;
        const res = await env.ASSETS.fetch(request);
        // Admin pages must never be cached by shared caches.
        const out = new Response(res.body, res);
        out.headers.set("Cache-Control", "no-store");
        out.headers.set("X-Robots-Tag", "noindex");
        return out;
      }
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error("Unhandled error", { path: url.pathname, message: err && err.message });
      return error(500, "internal_error", "Something went wrong.");
    }
  },
};
