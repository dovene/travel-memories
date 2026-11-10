/* API router. Public routes (Phase 2) and admin routes (Phase 3) will be added here. */
import { json, notFound, methodNotAllowed } from "../utils/responses.js";

export const VERSION = "0.1.0";

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

export async function handleApi(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
    return health(env);
  }

  return notFound();
}
