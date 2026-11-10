/* Consistent JSON responses and security headers for the API. */

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

/* Errors never expose internals: a stable code plus a human-readable message. */
export function error(status, code, message) {
  return json({ error: { code, message } }, status);
}

export const notFound = () => error(404, "not_found", "Resource not found.");
export const methodNotAllowed = (allow) =>
  new Response(null, { status: 405, headers: { Allow: allow.join(", "), ...SECURITY_HEADERS } });
