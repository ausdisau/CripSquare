/**
 * Session-cookie forum trust boundary. No network/DB dependencies.
 * Complements Auth0 and SameSite cookies, not a substitute for either.
 */
export type ForumWriteContext = {
  method: string;
  origin?: string | null;
  configuredOrigin?: string | null;
  fetchSite?: string | null;
  production?: boolean;
};

/** Only a single explicitly configured web origin is trusted. */
export function isAllowedForumWrite(input: ForumWriteContext): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(input.method.toUpperCase())) return true;
  if (!input.origin || !input.configuredOrigin) return false;
  if (input.fetchSite && input.fetchSite !== "same-origin") return false;
  try {
    const actual = new URL(input.origin);
    const expected = new URL(input.configuredOrigin);
    const validOrigin = (url: URL, value: string): boolean =>
      value === url.origin &&
      url.username === "" && url.password === "" &&
      url.pathname === "/" && url.search === "" && url.hash === "" &&
      (url.protocol === "https:" ||
        (!input.production && url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
    return validOrigin(actual, input.origin) &&
      validOrigin(expected, input.configuredOrigin) &&
      actual.origin === expected.origin;
  } catch {
    return false;
  }
}

/**
 * Drizzle user relations include email and administrative fields.
 * Select public display properties explicitly; never spread account records.
 * These fields remain personal information and require member-only access.
 */
export type ForumDisplayAuthor = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
};

export function safeForumAuthor(author: unknown): ForumDisplayAuthor | null {
  if (!author || typeof author !== "object" || Array.isArray(author)) return null;
  const record = author as Record<string, unknown>;
  const nullableText = (value: unknown): string | null =>
    typeof value === "string" ? value : null;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  return {
    id: record.id,
    firstName: nullableText(record.firstName),
    lastName: nullableText(record.lastName),
    profileImageUrl: nullableText(record.profileImageUrl),
  };
}
