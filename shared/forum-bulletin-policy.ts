/**
 * Platform-neutral forum input/permission rules.
 *
 * No browser, database, Node or React dependencies: usable by web,
 * React Native, API handlers and deterministic tests.
 */
export class ForumInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForumInputError";
  }
}

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

export function bulletinEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.CRIPSQUARE_FORUM_BULLETIN_ENABLED === "true";
}

export function parseForumSearch(raw: {
  q?: unknown; category?: unknown; page?: unknown;
}): {
  query: string;
  category: string | null;
  page: number;
  pageSize: 20;
  offset: number;
} {
  const query = asString(raw.q).trim();
  if (query.length < 2 || query.length > 120) {
    throw new ForumInputError("Search must be between 2 and 120 characters.");
  }
  const rawCategory = asString(raw.category).trim();
  if (rawCategory && !/^[a-z0-9-]{1,60}$/.test(rawCategory)) {
    throw new ForumInputError("Invalid forum category.");
  }
  const rawPage = raw.page === undefined ? "1" : asString(raw.page);
  if (!/^[1-9]\d{0,2}$/.test(rawPage)) {
    throw new ForumInputError("Invalid page.");
  }
  const page = Number(rawPage);
  if (page > 200) {
    throw new ForumInputError("Please refine your search to see more results.");
  }
  return { query, category: rawCategory || null, page, pageSize: 20, offset: (page - 1) * 20 };
}

function stringArray(value: unknown, label: string, maxItems: number, maxLength: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new ForumInputError("Invalid " + label + ".");
  }
  return value.map(item => {
    if (typeof item !== "string" || item.trim().length < 1 || item.length > maxLength) {
      throw new ForumInputError("Invalid " + label + ".");
    }
    return item.trim();
  });
}

export function validateThreadDraft(raw: {
  title?: unknown; body?: unknown; tags?: unknown; mediaUrls?: unknown; isAdviceRequest?: unknown;
}): {
  title: string; body: string; tags: string[]; mediaUrls: string[]; isAdviceRequest: boolean;
} {
  const title = asString(raw.title).trim();
  if (title.length < 5 || title.length > 180) {
    throw new ForumInputError("Thread title must be between 5 and 180 characters.");
  }
  const body = validatedBody(raw.body);
  const tags = stringArray(raw.tags, "tags", 8, 40);
  const mediaUrls = validatedMediaUrls(raw.mediaUrls);
  if (raw.isAdviceRequest !== undefined && typeof raw.isAdviceRequest !== "boolean") {
    throw new ForumInputError("Invalid advice-request option.");
  }
  return { title, body, tags, mediaUrls, isAdviceRequest: raw.isAdviceRequest === true };
}

export function validatedBody(value: unknown): string {
  const body = asString(value).trim();
  if (body.length < 1 || body.length > 12000) {
    throw new ForumInputError("Post text must be between 1 and 12,000 characters.");
  }
  return body;
}

export function validateReplyDraft(raw: { body?: unknown; mediaUrls?: unknown }): {
  body: string; mediaUrls: string[];
} {
  return { body: validatedBody(raw.body), mediaUrls: validatedMediaUrls(raw.mediaUrls) };
}

function validatedMediaUrls(value: unknown): string[] {
  const links = stringArray(value, "image links", 4, 2048);
  return links.map(link => {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw new ForumInputError("Image links must be valid HTTPS URLs.");
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
      throw new ForumInputError("Image links must be valid HTTPS URLs.");
    }
    return url.toString();
  });
}

export type ForumModerationAction = "lock" | "unlock" | "pin" | "unpin";

export function validateModerationRequest(input: unknown): {
  action: ForumModerationAction; reason: string;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ForumInputError("Invalid moderation request.");
  }
  const obj = input as Record<string, unknown>;
  const allowed: ForumModerationAction[] = ["lock", "unlock", "pin", "unpin"];
  if (!allowed.includes(obj.action as ForumModerationAction)) {
    throw new ForumInputError("Unknown moderation action.");
  }
  const reason = asString(obj.reason).trim();
  if (reason.length < 10 || reason.length > 500) {
    throw new ForumInputError("A 10–500 character moderation reason is required.");
  }
  return { action: obj.action as ForumModerationAction, reason };
}

export function mayModerateForum(isAdmin: boolean, isActive: boolean): boolean {
  return isAdmin === true && isActive === true;
}

export function mayReplyToThread(isLocked: boolean, isModerator: boolean): boolean {
  // No bypass: even moderators must explicitly unlock to re-open discussion.
  return isLocked === false;
}

/** Search term literal matching, not wildcard injection in SQL ILIKE. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, char => "\\" + char);
}
