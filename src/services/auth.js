/*
 * Authentication boundary. Returns the authenticated session ({ ownerId }) or null.
 *
 * Phase 2: real login does not exist yet (Phase 3), so every deployed admin request is
 * rejected. For local development only, DEV_OWNER_ID (set in the git-ignored .dev.vars file)
 * signs requests to localhost in as that owner. This never applies to staging or production:
 * their ENVIRONMENT is fixed in wrangler.toml and `npm run check` forbids DEV_OWNER_ID there.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function getSession(request, env) {
  if (env.ENVIRONMENT === "development" && env.DEV_OWNER_ID) {
    const { hostname } = new URL(request.url);
    if (LOCAL_HOSTS.has(hostname)) return { ownerId: env.DEV_OWNER_ID, dev: true };
  }
  return null;
}
