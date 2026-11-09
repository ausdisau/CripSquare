import assert from "node:assert/strict";
import test from "node:test";
import {
  ForumInputError,
  bulletinEnabled,
  escapeLike,
  mayModerateForum,
  mayReplyToThread,
  parseForumSearch,
  validateModerationRequest,
  validateReplyDraft,
  validateThreadDraft,
} from "../shared/forum-bulletin-policy.ts";

test("bulletin defaults off", () => {
  assert.equal(bulletinEnabled({}), false);
  assert.equal(bulletinEnabled({ CRIPSQUARE_FORUM_BULLETIN_ENABLED: "true" }), true);
  assert.equal(bulletinEnabled({ CRIPSQUARE_FORUM_BULLETIN_ENABLED: "TRUE" }), false);
});

test("search pagination and category are bounded", () => {
  assert.deepEqual(parseForumSearch({ q: "   transport  ", category: "mobility", page: "3" }), {
    query: "transport", category: "mobility", page: 3, pageSize: 20, offset: 40,
  });
  assert.throws(() => parseForumSearch({ q: "x" }), ForumInputError);
  assert.throws(() => parseForumSearch({ q: "ok", page: "201" }), ForumInputError);
  assert.throws(() => parseForumSearch({ q: "ok", page: "1 OR 1=1" }), ForumInputError);
  assert.throws(() => parseForumSearch({ q: "ok", category: "../admin" }), ForumInputError);
});

test("search escapes literal wildcard characters", () => {
  assert.equal(escapeLike("10%_wheel\\chair"), "10\\%\\_wheel\\\\chair");
});

test("thread draft keeps Unicode, bounded tags and safe HTTPS image links", () => {
  const post = validateThreadDraft({
    title: "AAC access at transport stops",
    body: "I would like accessible announcements.",
    tags: ["AAC"], mediaUrls: ["https://example.org/path.png"], isAdviceRequest: true,
  });
  assert.equal(post.tags[0], "AAC");
  assert.equal(post.isAdviceRequest, true);
  assert.throws(() => validateThreadDraft({ title: "short", body: "x".repeat(12001) }), ForumInputError);
  assert.throws(() => validateThreadDraft({
    title: "Valid subject", body: "Valid content", mediaUrls: ["javascript:alert(1)"],
  }), ForumInputError);
});

test("reply draft rejects empty and excessive content", () => {
  assert.equal(validateReplyDraft({ body: " Thank you. " }).body, "Thank you.");
  assert.throws(() => validateReplyDraft({ body: " " }), ForumInputError);
});

test("moderation actions require a specific reason", () => {
  assert.deepEqual(validateModerationRequest({
    action: "lock", reason: "Repeated off-topic harassment.",
  }), { action: "lock", reason: "Repeated off-topic harassment." });
  assert.throws(() => validateModerationRequest({ action: "delete", reason: "Long reason here" }), ForumInputError);
  assert.throws(() => validateModerationRequest({ action: "pin", reason: "x" }), ForumInputError);
});

test("admin and lock policies never grant implicit authority", () => {
  assert.equal(mayModerateForum(true, true), true);
  assert.equal(mayModerateForum(true, false), false);
  assert.equal(mayModerateForum(false, true), false);
  assert.equal(mayReplyToThread(true, false), false);
  assert.equal(mayReplyToThread(true, true), false);
  assert.equal(mayReplyToThread(false, false), true);
});
