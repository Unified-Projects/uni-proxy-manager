import { type Context, type Next } from "hono";

/**
 * Security headers middleware.
 * Adds standard security headers to all API responses to mitigate
 * common web vulnerabilities (clickjacking, MIME sniffing, XSS, etc.).
 */
export async function securityHeadersMiddleware(c: Context, next: Next) {
  await next();

  // Prevent MIME type sniffing
  c.header("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking by disallowing framing
  c.header("X-Frame-Options", "DENY");

  // Disable legacy XSS auditor -- modern best practice is to rely on CSP instead
  c.header("X-XSS-Protection", "0");

  // Control how much referrer information is sent with requests
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");

  // Basic Content Security Policy: only allow resources from same origin
  c.header("Content-Security-Policy", "default-src 'self'");

  // Restrict access to browser features that the API does not need
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}
