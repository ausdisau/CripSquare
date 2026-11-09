-- Additive only. Review against a *branch* of the configured PostgreSQL
-- before executing. Do not run against production without separate approval.
BEGIN;
CREATE TABLE IF NOT EXISTS forum_thread_controls (
  thread_id integer PRIMARY KEY REFERENCES forum_threads(id) ON DELETE CASCADE,
  is_locked boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  updated_by varchar REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forum_thread_subscriptions (
  id serial PRIMARY KEY,
  thread_id integer NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS forum_subscription_user_thread_uq
  ON forum_thread_subscriptions(user_id, thread_id);
CREATE INDEX IF NOT EXISTS forum_subscription_thread_idx
  ON forum_thread_subscriptions(thread_id);

CREATE TABLE IF NOT EXISTS forum_moderation_audit (
  id serial PRIMARY KEY,
  thread_id integer NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  moderator_id varchar NOT NULL REFERENCES users(id),
  action varchar(10) NOT NULL
    CHECK (action IN ('lock', 'unlock', 'pin', 'unpin')),
  reason text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forum_moderation_thread_idx
  ON forum_moderation_audit(thread_id);

CREATE TABLE IF NOT EXISTS forum_analytics_consents (
  user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  opted_in boolean NOT NULL DEFAULT false,
  updated_at timestamp NOT NULL DEFAULT now()
);
COMMIT;
