import type { Request, Response, NextFunction } from "express";
import { isAllowedForumWrite } from "@shared/forum-bulletin-security-policy";

/**
 * Applied AFTER existing Auth0 and age verification and BEFORE every
 * forum route, including legacy write APIs. The bulletin stays flag-gated.
 * Browser cookies cannot be replayed by a different web origin.
 *
 * Mobile OIDC bearer support is intentionally excluded until the server
 * implements independently verified audience/scope and device flows.
 */
export function requireForumCookieOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("Cache-Control", "private, no-store");
  if (isAllowedForumWrite({
    method: req.method,
    origin: req.get("origin"),
    configuredOrigin: process.env.CRIPSQUARE_FORUM_PUBLIC_ORIGIN,
    fetchSite: req.get("sec-fetch-site"),
    production: process.env.NODE_ENV === "production",
  })) {
    next();
    return;
  }
  res.status(403).json({
    code: "FORUM_ORIGIN_DENIED",
    message: "This forum action needs a session on the official CripSquare website. Please reopen your draft there.",
  });
}
