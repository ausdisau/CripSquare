import {
  boolean, index, integer, pgTable, serial, text, timestamp,
  uniqueIndex, varchar,
} from "drizzle-orm/pg-core";
import { forumThreads, users } from "./schema";

/** Additive tables only. Existing forum schema and auth remain authoritative. */
export const forumThreadControls = pgTable("forum_thread_controls", {
  threadId: integer("thread_id").primaryKey()
    .references(() => forumThreads.id, { onDelete: "cascade" }),
  isLocked: boolean("is_locked").notNull().default(false),
  isPinned: boolean("is_pinned").notNull().default(false),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const forumThreadSubscriptions = pgTable("forum_thread_subscriptions", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull()
    .references(() => forumThreads.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => ({
  userThreadUnique: uniqueIndex("forum_subscription_user_thread_uq")
    .on(table.userId, table.threadId),
  threadIndex: index("forum_subscription_thread_idx").on(table.threadId),
}));

export const forumModerationAudit = pgTable("forum_moderation_audit", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull()
    .references(() => forumThreads.id, { onDelete: "cascade" }),
  moderatorId: varchar("moderator_id").notNull()
    .references(() => users.id),
  action: varchar("action", { length: 10 }).notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => ({
  threadIndex: index("forum_moderation_thread_idx").on(table.threadId),
}));

export const forumAnalyticsConsents = pgTable("forum_analytics_consents", {
  userId: varchar("user_id").primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  optedIn: boolean("opted_in").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
