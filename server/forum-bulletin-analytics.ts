import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { forumAnalyticsConsents } from "@shared/forum-bulletin-schema";

/**
 * Opt-in only, discrete, text-free analytics. No autocapture, replay, raw
 * usernames, URLs, post content, mobility/health data, or thread identifiers.
 * Shipping this file NEVER enables event sending: consent and explicit
 * env approval are both mandatory. A failed analytics call never blocks UX.
 */
export type ForumTelemetryEvent =
  | "forum_search_completed"
  | "forum_subscription_changed";

export async function captureConsentedForumEvent(
  actorId: string,
  event: ForumTelemetryEvent,
): Promise<void> {
  if (process.env.CRIPSQUARE_FORUM_POSTHOG_ENABLED !== "true") return;
  const token = process.env.POSTHOG_PROJECT_API_KEY;
  const secret = process.env.CRIPSQUARE_FORUM_ANALYTICS_PEPPER;
  const host = process.env.POSTHOG_HOST;
  if (!token || !secret || secret.length < 20) return;
  if (host !== "https://us.i.posthog.com" && host !== "https://eu.i.posthog.com") return;

  try {
    const [consent] = await db.select({ optedIn: forumAnalyticsConsents.optedIn })
      .from(forumAnalyticsConsents)
      .where(eq(forumAnalyticsConsents.userId, actorId))
      .limit(1);
    if (consent?.optedIn !== true) return;

    const distinct_id = createHmac("sha256", secret).update(actorId).digest("hex");
    await fetch(host + "/capture/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: token,
        event,
        distinct_id,
        properties: { $process_person_profile: false, surface: "forum_bulletin" },
      }),
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
  } catch {
    // Fail silent; analytics is not needed for participation or moderation.
  }
}
