/*
 * Travel Memories Worker entry point.
 *
 * Static files in public/ are served by Workers Static Assets before this code runs;
 * only /api/* requests reach fetch() (see `run_worker_first` in wrangler.toml).
 *
 * Note: the Workers runtime only accepts handlers as exports of this module,
 * so constants and helpers live in other modules.
 */
import { handleApi } from "./routes/api.js";
import { error } from "./utils/responses.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, ctx);
      }
      // Anything else that reaches the Worker falls back to static assets.
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error("Unhandled error", { path: url.pathname, message: err && err.message });
      return error(500, "internal_error", "Something went wrong.");
    }
  },
};
