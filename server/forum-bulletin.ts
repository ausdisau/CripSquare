import type { Express, NextFunction, Request, Response } from "express";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "./db";
import { isAuthenticated, requiresAgeVerification } from "./auth0";
import { forumCategories, forumThreads, profiles, users } from "@shared/schema";
import {
  forumAnalyticsConsents, forumModerationAudit,
  forumThreadControls, forumThreadSubscriptions,
} from "@shared/forum-bulletin-schema";
import {
  ForumInputError, bulletinEnabled, escapeLike, mayModerateForum,
  parseForumSearch, validateModerationRequest, validateReplyDraft,
  validateThreadDraft,
} from "@shared/forum-bulletin-policy";
import { consumeForumRateLimit, ForumRateLimitUnavailable } from "./forum-bulletin-redis";
import { captureConsentedForumEvent } from "./forum-bulletin-analytics";

function userId(req: Request): string | null {
  const session = (req as any).oidc;
  return session?.isAuthenticated?.() && typeof session?.user?.sub === "string"
    ? session.user.sub : null;
}

function fail(res: Response, error: unknown): void {
  if (error instanceof ForumInputError) {
    res.status(400).json({ message: error.message });
  } else if (error instanceof ForumRateLimitUnavailable) {
    res.status(503).json({ message: error.message, code: "RATE_LIMIT_UNAVAILABLE" });
  } else {
    console.error("Bulletin forum error:", error instanceof Error ? error.name : "Unknown");
    res.status(500).json({ message: "Forum temporarily unavailable." });
  }
}

async function permit(
  id: string, action: "thread" | "reply" | "subscribe" | "moderate" | "search",
  res: Response,
): Promise<boolean> {
  const rate = await consumeForumRateLimit(id, action);
  if (rate.allowed) return true;
  res.setHeader("Retry-After", String(rate.retryAfterSeconds));
  res.status(429).json({ message: "Too many requests. Please try again shortly.", code: "RATE_LIMITED" });
  return false;
}

async function ageOK(id: string): Promise<boolean> {
  const [p] = await db.select({ verified: profiles.ageVerified })
    .from(profiles).where(eq(profiles.userId, id)).limit(1);
  return p?.verified === true;
}

async function threadExists(threadId: number): Promise<boolean> {
  const [t] = await db.select({ id: forumThreads.id })
    .from(forumThreads).where(eq(forumThreads.id, threadId)).limit(1);
  return !!t;
}

async function canModerate(id: string): Promise<boolean> {
  const [user] = await db.select({ isAdmin: users.isAdmin, isActive: users.isActive })
    .from(users).where(eq(users.id, id)).limit(1);
  return mayModerateForum(user?.isAdmin === true, !!user && user.isActive !== false);
}

function validId(req: Request): number {
  const value = Number(req.params.id);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ForumInputError("Invalid thread identifier.");
  }
  return value;
}

/** Applied to legacy POSTs before the existing storage handlers. */
export async function guardForumThreadCreate(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  if (!bulletinEnabled(process.env)) return next();
  const actor = userId(req);
  if (!actor) return void res.status(401).json({ message: "Sign in required." });
  try {
    if (!await ageOK(actor)) {
      res.status(403).json({ message: "Community age check required.", code: "AGE_VERIFICATION_REQUIRED" });
      return;
    }
    req.body = validateThreadDraft(req.body ?? {});
    if (!await permit(actor, "thread", res)) return;
    next();
  } catch (error) { fail(res, error); }
}

export async function guardForumReplyCreate(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  if (!bulletinEnabled(process.env)) return next();
  const actor = userId(req);
  if (!actor) return void res.status(401).json({ message: "Sign in required." });
  try {
    if (!await ageOK(actor)) {
      res.status(403).json({ message: "Community age check required.", code: "AGE_VERIFICATION_REQUIRED" });
      return;
    }
    const threadId = validId(req);
    req.body = validateReplyDraft(req.body ?? {});
    if (!await threadExists(threadId)) {
      res.status(404).json({ message: "Thread not found." });
      return;
    }
    const [s] = await db.select({ locked: forumThreadControls.isLocked })
      .from(forumThreadControls)
      .where(eq(forumThreadControls.threadId, threadId)).limit(1);
    if (s?.locked) {
      res.status(423).json({ message: "This discussion is locked.", code: "THREAD_LOCKED" });
      return;
    }
    if (!await permit(actor, "reply", res)) return;
    next();
  } catch (error) { fail(res, error); }
}

/**
 * Member-only feature slice. Does not replace the existing forum or login.
 * Activation requires approved migration and Redis server credentials.
 */
export function registerForumBulletin(app: Express): void {
  if (!bulletinEnabled(process.env)) return;
  const member = [isAuthenticated, requiresAgeVerification];

  app.get("/api/forums/bulletin/capabilities", ...member, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      enabled: true, search: true, subscriptions: true,
      moderation: true, analytics: "optional_opt_in",
      notificationDelivery: false, editHistory: false,
    });
  });

  app.get("/api/forums/bulletin/search", ...member, async (req, res) => {
    const actor = userId(req);
    if (!actor) return void res.status(401).json({ message: "Sign in required." });
    try {
      const { query, category, page, pageSize, offset } = parseForumSearch(req.query);
      if (!await permit(actor, "search", res)) return;
      const pattern = "%" + escapeLike(query) + "%";
      const match = or(ilike(forumThreads.title, pattern), ilike(forumThreads.body, pattern));
      const where = category
        ? and(match, eq(forumCategories.slug, category)) : match;
      const rows = await db.select({
        id: forumThreads.id, title: forumThreads.title, body: forumThreads.body,
        categorySlug: forumCategories.slug, categoryName: forumCategories.name,
        replyCount: forumThreads.replyCount, isSolved: forumThreads.isSolved,
        lastActivityAt: forumThreads.lastActivityAt,
        locked: forumThreadControls.isLocked, pinned: forumThreadControls.isPinned,
      }).from(forumThreads)
        .innerJoin(forumCategories, eq(forumCategories.id, forumThreads.categoryId))
        .leftJoin(forumThreadControls, eq(forumThreadControls.threadId, forumThreads.id))
        .where(where)
        .orderBy(desc(forumThreads.lastActivityAt), desc(forumThreads.id))
        .limit(pageSize + 1).offset(offset);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        query, category, page, pageSize,
        hasMore: rows.length > pageSize,
        results: rows.slice(0, pageSize).map(({ body, locked, pinned, ...item }) => ({
          ...item,
          excerpt: body.slice(0, 200),
          isLocked: locked === true, isPinned: pinned === true,
        })),
      });
      void captureConsentedForumEvent(actor, "forum_search_completed");
    } catch (error) { fail(res, error); }
  });

  app.get("/api/forums/bulletin/threads/:id/settings", ...member, async (req, res) => {
    const actor = userId(req);
    if (!actor) return void res.status(401).json({ message: "Sign in required." });
    try {
      const threadId = validId(req);
      if (!await threadExists(threadId)) {
        res.status(404).json({ message: "Thread not found." });
        return;
      }
      const [s] = await db.select().from(forumThreadControls)
        .where(eq(forumThreadControls.threadId, threadId)).limit(1);
      const [subscription] = await db.select({ id: forumThreadSubscriptions.id })
        .from(forumThreadSubscriptions).where(and(
          eq(forumThreadSubscriptions.threadId, threadId),
          eq(forumThreadSubscriptions.userId, actor),
        )).limit(1);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        isLocked: s?.isLocked === true, isPinned: s?.isPinned === true,
        subscribed: !!subscription, canModerate: await canModerate(actor),
        notifications: "not_enabled",
      });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/forums/bulletin/threads/:id/subscribe", ...member, async (req, res) => {
    const actor = userId(req);
    if (!actor) return void res.status(401).json({ message: "Sign in required." });
    try {
      const threadId = validId(req);
      if (!await threadExists(threadId)) {
        res.status(404).json({ message: "Thread not found." });
        return;
      }
      if (!await permit(actor, "subscribe", res)) return;
      await db.insert(forumThreadSubscriptions).values({ threadId, userId: actor })
        .onConflictDoNothing();
      res.setHeader("Cache-Control", "private, no-store");
      res.status(201).json({ subscribed: true, notifications: "not_enabled" });
      void captureConsentedForumEvent(actor, "forum_subscription_changed");
    } catch (error) { fail(res, error); }
  });

  app.delete("/api/forums/bulletin/threads/:id/subscribe", ...member, async (req, res) => {
    const actor = userId(req);
    if (!actor) return void res.status(401).json({ message: "Sign in required." });
    try {
      const threadId = validId(req);
      if (!await permit(actor, "subscribe", res)) return;
      await db.delete(forumThreadSubscriptions).where(and(
        eq(forumThreadSubscriptions.threadId, threadId),
        eq(forumThreadSubscriptions.userId, actor),
      ));
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ subscribed: false, notifications: "not_enabled" });
      void captureConsentedForumEvent(actor, "forum_subscription_changed");
    } catch (error) { fail(res, error); }
  });

  app.get("/api/forums/bulletin/me/subscriptions", ...member, async (req, res) => {
    const actor = userId(req);
    if (!actor) return void res.status(401).json({ message: "Sign in required." });
    try {
      const rows = await db.select({
        threadId: forumThreads.id,
        title: forumThreads.title, categorySlug: forumCategories.slug,
        subscribedAt: forumThreadSubscriptions.createdAt,
      }).from(forumThreadSubscriptions)
        .innerJoin(forumThreads, eq(forumThreads.id, forumThreadSubscriptions.threadId))
        .innerJoin(forumCategories, eq(forumCategories.id, forumThreads.categoryId))
        .where(eq(forumThreadSubscriptions.userId, actor))
        .orderBy(desc(forumThreadSubscriptions.createdAt)).limit(50);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ subscriptions: rows, notifications: "not_enabled" });
    } catch (error) { fail(res, error); }
  });

  app.patch("/api/forums/bulletin/threads/:id/moderation", ...member, async (req, res) => {
    const actor = userId(req);
    if (!actor) return void res.status(401).json({ message: "Sign in required." });
    try {
      const threadId = validId(req);
      if (!await canModerate(actor)) {
        res.status(403).json({ message: "Moderator access required." });
        return;
      }
      const { action, reason } = validateModerationRequest(req.body);
      if (!await threadExists(threadId)) {
        res.status(404).json({ message: "Thread not found." });
        return;
      }
      if (!await permit(actor, "moderate", res)) return;
      const now = new Date();
      const updated = await db.transaction(async tx => {
        const update = (action === "lock" || action === "unlock")
          ? { isLocked: action === "lock", updatedAt: now, updatedBy: actor }
          : { isPinned: action === "pin", updatedAt: now, updatedBy: actor };
        const [row] = await tx.insert(forumThreadControls).values({
          threadId, isLocked: action === "lock", isPinned: action === "pin",
          updatedAt: now, updatedBy: actor,
        }).onConflictDoUpdate({ target: forumThreadControls.threadId, set: update })
          .returning();
        await tx.insert(forumModerationAudit).values({
          threadId, moderatorId: actor, action, reason,
        });
        return row;
      });
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ isLocked: updated.isLocked, isPinned: updated.isPinned });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/forums/bulletin/threads/:id/audit", ...member, async (req, res) => {
    const actor = userId(req);
    if (!actor) return void res.status(401).json({ message: "Sign in required." });
    try {
      if (!await canModerate(actor)) {
        res.status(403).json({ message: "Moderator access required." });
        return;
      }
      const threadId = validId(req);
      const rows = await db.select({
        action: forumModerationAudit.action, reason: forumModerationAudit.reason,
        createdAt: forumModerationAudit.createdAt,
      }).from(forumModerationAudit)
        .where(eq(forumModerationAudit.threadId, threadId))
        .orderBy(desc(forumModerationAudit.createdAt)).limit(50);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ actions: rows });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/forums/bulletin/me/analytics-consent", ...member, async (req, res) => {
    const actor = userId(req);
    if (!actor) return void res.status(401).json({ message: "Sign in required." });
    try {
      const [row] = await db.select({ optedIn: forumAnalyticsConsents.optedIn })
        .from(forumAnalyticsConsents)
        .where(eq(forumAnalyticsConsents.userId, actor)).limit(1);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ optedIn: row?.optedIn === true });
    } catch (error) { fail(res, error); }
  });

  app.put("/api/forums/bulletin/me/analytics-consent", ...member, async (req, res) => {
    const actor = userId(req);
    if (!actor) return void res.status(401).json({ message: "Sign in required." });
    try {
      if (typeof req.body?.optedIn !== "boolean") {
        res.status(400).json({ message: "Choose yes or no." });
        return;
      }
      const optedIn: boolean = req.body.optedIn;
      await db.insert(forumAnalyticsConsents).values({ userId: actor, optedIn })
        .onConflictDoUpdate({
          target: forumAnalyticsConsents.userId,
          set: { optedIn, updatedAt: new Date() },
        });
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ optedIn });
    } catch (error) { fail(res, error); }
  });
}
