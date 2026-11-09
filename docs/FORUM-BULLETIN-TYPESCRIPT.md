# CripSquare TypeScript Bulletin Board (phpBB / bbPress style)

**Status: draft, not released.** Developed in \`feature/typescript-bulletin-forum-20261110\`. No existing production settings, tables, authentication service or domains have been changed. This is an additive enhancement to the forum already present in CripSquare's React/Vite + Express + Drizzle repository, **not** a fresh competing application.

## What exists and what this changes

Existing CripSquare:
- Forum category directory, thread authorship, discussions, replies, upvotes, accepted answers, reporting, age-verification onboarding and Auth0 authentication.
- React/Vite client via Wouter, Express API running under Vercel function, Drizzle with PostgreSQL.
- Two parallel Next.js route trees also exist in the repository. **Do not assume Next.js is the actual production forum runtime:** the current \`vercel.json\` serves \`dist/public\` and \`api/index.ts\`.

New opt-in bulletin layer:
- \`/forums/search\`: member-only thread title/opening-post search, category filtering and pages of 20, chronological result ordering, explicit status labels and accessible GET form.
- \`/api/forums/bulletin/search\`: server-bound result cap, escaped search pattern, rate limiting and no personal author profiles.
- Forum thread follow/unfollow: durable, private per-user subscriptions. **Following is not an email/push notification feature.**
- Moderator-only pin/unpin and lock/unlock, audited in the same database transaction; locking is honoured by the existing reply endpoint when enabled. Existing user reporting remains the report entrypoint.
- Personal analytics opt-in/off, off by default. PostHog receives only enumerated feature events with pseudonymous HMAC-derived IDs and \`$process_person_profile:false\`. No forum content, search words, URLs, ages, diagnosis, AAC preferences or replay. Analytics disabled by separate server flag.
- Redis/Upstash REST EVAL-based per-account atomic fixed-window abuse-rate limits. When the bulletin is enabled but Redis is not configured, affected writes/search return 503 rather than becoming unprotected.

### Still not implemented (don't claim these are live)

Full reply-body search; notifications or emails; private messages inside the new bulletin layer (existing separate DMs remain); edit history; category-level moderators; attachment scanning/storage; reactions beyond current voting; content hiding/deletion; complete React Native app; direct OSM/MapAble Signal data sharing. Existing text/reporting flow remains available under the legacy forum. Moderator and reply insertion now share a PostgreSQL thread-row lock inside transactions, but independent database concurrency tests are still a release gate.

## Routes

| Verb | Path | Access |
| --- | --- | --- |
| GET | /api/forums/bulletin/capabilities | Auth0 session + existing age check |
| GET | /api/forums/bulletin/search?q=...&category=...&page=... | Auth0 session + age check; Redis limit |
| GET | /api/forums/bulletin/threads/:id/settings | Auth0 + age check, own subscription only |
| POST / DELETE | /api/forums/bulletin/threads/:id/subscribe | Auth0 + age check + Redis |
| GET | /api/forums/bulletin/me/subscriptions | Auth0 + age check, own list |
| PATCH | /api/forums/bulletin/threads/:id/moderation | Auth0 + age check, active admin in database, reason, Redis, audit |
| GET | /api/forums/bulletin/threads/:id/audit | Admin only |
| GET / PUT | /api/forums/bulletin/me/analytics-consent | Own consent only |

Legacy create thread and create reply POST endpoints call the new validation and rate-guard code when bulletin flag is ON. When it is OFF, existing routes behave as before.

## Data and hosting

**PostgreSQL / Neon:** Existing \`server/db.ts\` uses \`SUPABASE_DATABASE_URL || DATABASE_URL\` with the current Node Postgres pool and Drizzle. Don't silently change database authority. Use an Australian-region Neon test branch only after verifying eligibility, access, data residency, backup/restore and existing tables. \`DATABASE_URL\` alone won't override a present \`SUPABASE_DATABASE_URL\`. No connection strings should be committed.

**Migration:** \`scripts/sql/20261110_forum_bulletin_additive.sql\` creates four new tables and indexes, without altering existing forum data. Apply to an isolated TEST database only following review. The new schema is defined in \`shared/forum-bulletin-schema.ts\`. Default-off server flag avoids new-table queries until migration and release decisions have been completed.

**Redis:** \`UPSTASH_REDIS_REST_URL\`, \`UPSTASH_REDIS_REST_TOKEN\`, and \`CRIPSQUARE_FORUM_RATE_PEPPER\` (20+ random characters) are server secrets. The adapter uses atomic Redis EVAL, never Redis for durable posts. Shared limit on all instances; Redis outage fails closed. If a different Redis service is selected, provide a tested driver implementation rather than assuming standard Redis supports this REST endpoint.

**PostHog:** \`POSTHOG_PROJECT_API_KEY\`, \`POSTHOG_HOST\` (exactly \`https://us.i.posthog.com\` or \`https://eu.i.posthog.com\`), \`CRIPSQUARE_FORUM_ANALYTICS_PEPPER\` (20+ random characters), \`CRIPSQUARE_FORUM_POSTHOG_ENABLED=true\`. Requires separate consent record and privacy/offshore transfer assessment. Disabling telemetry and opting out only stops future events; existing captured events need the configured retention/deletion process.

**Feature:** \`CRIPSQUARE_FORUM_BULLETIN_ENABLED=true\` activates new endpoints and existing-post guards on a restarted server. Default is OFF; **do not enable production before the security and accessibility gates below pass**.

**Vercel:** Existing Vercel deployment is an Express Vercel Function, not an independent Next.js bulletin project. Leave current production domain and project untouched. Any new Vercel preview must be separately permissioned and not connected to production DB or external analytics.

## Accessibility and safeguarding acceptance

- Keyboard navigation, switch access, screen reader labels and announcements, visible focus, high zoom, reduced motion and AAC-compatible form timing.
- Actions use text, not colour alone. No typing-speed gate, countdown to submit, coercive onboarding or high-frequency refresh.
- Users can edit their search terms, withdraw analytics consent, follow/unfollow without notifications, and report existing community content.
- Apply Australian eSafety safeguarding, user reporting, moderation appeal, youth member visibility and confidential support disclosures. No assumption that a disability disclosure is consent to analytics or third-party sharing.
- The current public legacy API presents a **privacy-policy inconsistency**: its underlying category/thread reads can be public even though Vite forum screens are behind \`PrivateRoute\`. Existing minor-author anonymisation does not automatically imply all post content is private. Review public/member visibility rules before launch.
- Review cross-origin request forgery for Auth0 cookie mutations, moderator concurrency, content ingestion bounds, external image links, rate-limit fairness and tracing retention.
- A static/code test pass **does not certify WCAG 2.2 AA**. Run disability-led acceptance with real devices and screen readers.

## Validation

\`\`\`bash
node --experimental-strip-types --test tests/forum-bulletin-policy.test.mjs
npm ci
npm run check
npm run build
\`\`\`

The targeted GitHub Actions workflow is \`.github/workflows/forum-bulletin-checks.yml\`. No CI success has been claimed without run results.

## Mobile / React Native path

The neutral TypeScript rules in \`shared/forum-bulletin-policy.ts\` can be reused in an Expo/React Native client. API route names and JSON results are framework-neutral. Existing Express Auth0 middleware currently authenticates **browser sessions**. A mobile client must use OIDC Authorization Code + PKCE with a properly verified bearer-token audience/scope on the backend; never simulate sessions or ship tokens in URLs. Build mobile UI only after that explicit authentication bridge and independent native accessibility testing.

## Next increments

1. Transaction-safe reply locking, origin/CSRF review and stronger all-route visibility enforcement; add end-to-end Express tests against isolated PostgreSQL.
2. Moderator queue and appeal workflow integration, editing with revisions, subscriptions with consent-controlled summaries.
3. Approve Neon staging, Redis health/runbook, PostHog privacy governance, Vercel protected preview and screen-reader/AAC usability audit.
4. Optional Expo forum companion reusing typed service contracts and verified mobile OIDC.


## Follow-on hardening (stacked draft)

- All `/api/forums` routes become authenticated and age-verified when the bulletin feature is enabled, including legacy category and detail GETs; access remains unchanged while the flag is OFF.
- Cookie-authenticated forum POST/PUT/PATCH/DELETE calls require the exact server-configured `CRIPSQUARE_FORUM_PUBLIC_ORIGIN`. Cross-site and same-site `Sec-Fetch-Site` contexts are denied, missing or mismatched origins fail closed. Configure the expected HTTPS origin separately for each isolated preview; localhost HTTP is development-only.
- All member-facing forum author joins are explicitly projected to id/name/avatar; email, account status, admin roles and other user fields cannot be serialized from the user relation when enabled.
- The forum server avoids including full forum API JSON bodies in logging (even with the feature OFF), reducing accidental disclosure of posts and author data.
- Thread insert/category count become atomic inside a transaction (when enabled). A successfully committed thread/reply is returned as 201 even when the non-essential points award fails; failed points are **not** automatically reconciled and need an operations workflow.
- A visible privacy control lets members opt into/out of optional analytics. It displays current state only when the bulletin is enabled. Events require the separate PostHog flag and do not include content.
- Local, framework-free Node 22 tests cover origin abuse cases and explicit author projections. End-to-end Auth0, PostgreSQL concurrency, security, Redis, analytics egress, AAC/switch and WCAG 2.2 AA acceptance remain required before production.
- The repository currently has unrelated TypeScript errors in its combined Next.js/Vite/Replit paths. Full `npm run check` is not presently green; isolate and fix these baseline errors without rewriting production auth.
- ESLint community flat config and TypeScript lint dependencies have **not** been added because `package-lock.json` must be regenerated from a controlled dependency install. Follow up with an isolated lint gate once the mixed-app build is normalised.
