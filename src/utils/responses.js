/* Consistent JSON responses, errors and security headers for the API. */

export const SECURITY_HEADERS = {
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

/*
 * Errors thrown anywhere in request handling. The router turns them into
 * { error: { code, message, details? } } responses; anything else becomes a generic 500.
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function error(status, code, message, details) {
  const body = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return json(body, status);
}

export const notFound = (message = "Resource not found.") => error(404, "not_found", message);

export const methodNotAllowed = (allow) =>
  new Response(null, { status: 405, headers: { Allow: allow.join(", "), ...SECURITY_HEADERS } });
