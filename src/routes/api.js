/* API router: /api/health, /api/public/*, /api/admin/*. */
import { ApiError, error, json, notFound, methodNotAllowed } from "../utils/responses.js";
import { handlePublic } from "./public.js";
import { handleAdmin } from "./admin.js";
import { getSession } from "../services/auth.js";

export const VERSION = "0.5.0";

async function health(env) {
  let storage = "unbound";
  if (env.STORAGE) {
    try {
      // A cheap round trip proving the binding works, without reading content.
      await env.STORAGE.head("content/.health");
      storage = "ok";
    } catch {
      storage = "error";
    }
  }
  return json({
    status: storage === "error" ? "degraded" : "ok",
    environment: env.ENVIRONMENT || "unknown",
    version: VERSION,
    storage,
  });
}

function segmentsOf(pathname, prefix) {
  return pathname
    .slice(prefix.length)
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        throw new ApiError(400, "invalid_path", "Malformed URL.");
      }
    });
}

/* `deps` lets tests inject authentication; production always uses services/auth.js. */
export async function handleApi(request, env, ctx, deps = { getSession }) {
  const { pathname } = new URL(request.url);
  try {
    if (pathname === "/api/health") {
      if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
      return await health(env);
    }
    if (pathname.startsWith("/api/public/")) return await handlePublic(request, env, segmentsOf(pathname, "/api/public/"), ctx, deps.getSession);
    if (pathname.startsWith("/api/admin/")) return await handleAdmin(request, env, segmentsOf(pathname, "/api/admin/"), deps);
    return notFound();
  } catch (err) {
    if (err instanceof ApiError) return error(err.status, err.code, err.message, err.details);
    throw err; // unexpected: the entry point logs it and answers a generic 500
  }
}
