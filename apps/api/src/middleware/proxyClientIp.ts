import type { NextFunction, Request, Response } from "express";

// Hosted behind a proxy (Render terminates TLS one hop in front of the Node
// service), x-forwarded-for arrives as a chain: client IP plus proxy hops.
// Better Auth only trusts a single-value header unless a trusted-proxy list
// is configured, so the chain fails resolution and its rate limiter degrades
// to a shared bucket. Express already resolves the real client IP via the
// `trust proxy` hop count (API_TRUST_PROXY_HOPS), so collapse the header to
// that resolved value before Better Auth sees the request.
export function forwardExpressClientIp(request: Request, _response: Response, next: NextFunction): void {
  if (request.ip) request.headers["x-forwarded-for"] = request.ip;
  next();
}
