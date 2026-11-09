# CripSquare / MapAble Signal: Cursor-Replit development bridge

**State: draft development bridge, not a live mirrored repository or a completed accessibility audit.**

## Decision

Use GitHub `ausdisau/CripSquare` for reviewing the shared **UX contract**, accessibility acceptance criteria, test evidence and implementation changes. Keep Replit `CeipSquare` as a **separate existing pnpm monorepo** until there is a verified and approved Git history, schema and authentication reconciliation. Cursor continues to work from a cloned GitHub repository. Both systems read and improve the same *semantic* contract; their app code is not copied or force-synchronised.

## Current inspected sources (10 November 2026)

- **Cursor/GitHub:** `ausdisau/CripSquare`, main revision `a8302aef2593ff8323e4b40d65cc43485cff0e13` (React/Vite/Express plus separate Next.js routes, Auth0, `client/src/App.tsx`, `client/src/components/Sidebar.tsx`). Existing `/groups`, `/forums`, `/blogs`, `/resources`, `/safety`; MapAble Signal merge pack is not installed in main.
- **Replit:** app titled `CeipSquare`, UUID `4bc4cb03-e9f9-4226-9086-b9fd3ad80f98`, Replit-Agent-inspected main revision `5148947`, web base `/cripsquare-web/`. Different pnpm monorepo: React/Vite/Wouter, Express 5, Clerk, Drizzle/Postgres, plus Expo mobile. Public `/communities`, `/forums`, `/blogs`, `/resources`, `/events`, `/accessibility`; `/signal` and a public reporting UI not found in inspected code.
- **Historical integration artifact:** earlier `CripSquare-MapAble-Signal-TypeScript-Merge-v0.1.zip` implements a *local-only* MapAble Signal route for the older GitHub React/Vite app, not Replit's web app. Treat it as a reviewed source of domain logic, not a drop-in Replit replacement.

**Important:** Auth0 and Clerk are different identity authorities. The Next.js and Vite sides of GitHub also coexist. Never equate route names with data ownership or copy credentials, user tables or server source across projects.

## Files and functions

- `ux-contract.v1.json`: stable journey IDs, privacy and accessibility gates; known route/auth differences are explicit.
- `snapshots/github-baseline.json`, `snapshots/replit-baseline.json`: code-inspection observations with revisions, not live production assertions.
- `scripts/bridge/check-contract.mjs`: offline validation, route inventory for GitHub Vite/Wouter, drift detection, Markdown and JSON reports. **No database or external access.**
- `scripts/bridge/remote-handshake.mjs`: optional metadata-only HTTPS check of a *separately authorised Replit development* endpoint. Proves matching contract fingerprints, not functional or visual parity.
- `tests/bridge/contract.test.mjs`: deterministic regression tests, no health/identity/member data.
- `.cursor/rules/cripsquare-ux-bridge.mdc` and root `AGENTS.md`: shared human-readable authoring policy.
- `.github/workflows/cripsquare-ux-bridge.yml`: runs tests and reports on PR/feature branch; optional scheduled metadata check once configured.

## Safe working loop

1. **Pick a journey ID** in the contract (e.g. `forums`, `groups`, `mapable-signal`) before developing. State its participant benefit, communication access, consent and moderation behaviour.
2. **Cursor:** work on a feature branch of `ausdisau/CripSquare`. Review the original change; do not overwrite the Replit files or change Next.js/React/Vite architectures inadvertently.
3. **Replit:** use `CeipSquare` app development checkpoint/branch and preserve its own monorepo. Implement the *same journey intent* with its existing Clerk, API, React and Expo conventions. Do not import the other GitHub application wholesale.
4. **Update evidence:** after inspecting actual code, update each platform snapshot's source revision and journey status. A new route or changed consent/auth requirement needs contract review. Do not mark 'present' based only on plans.
5. **Gate:** run the tests and checker, review known gaps in the accessibility report, then conduct real keyboard, screen reader, AAC, 200-400% zoom and reduced motion tests. A passing script only validates inspected snapshots, not deployed behaviour.
6. **Review and release:** prepare a GitHub PR, reconcile deviations with the Replit reviewer, require a separate human sign-off for identities, minors, privacy, safety and deployment. Replit's app publishing remains independently approved.

Run from the GitHub checkout (Node.js 22 or later):

```bash
node --test tests/bridge/contract.test.mjs
node scripts/bridge/check-contract.mjs --repo . --strict --out out/ux-report.md --json out/ux-report.json
```

For a test run from this standalone package (no GitHub checkout), omit `--repo` to compare only the supplied source snapshots. A standalone pass does **not** inspect live GitHub routes.

## Optional non-sensitive version handshake

A Replit *development-only* diagnostics resource may expose **only** `contractId`, `schemaVersion`, `contractSha256` and optionally `sourceRevision`. It must never expose user data, file content, tokens, account/health/diagnosis/location or unreviewed audits. The endpoint may be offered only in dev/preview; never require it to be public in production. After reviewing its response and access controls, an operator may set GitHub repository variable `CRIPSQUARE_REPLIT_UX_STATUS_URL` to the approved HTTPS Replit diagnostics URL. CI checks contract fingerprint parity without changing Replit code. Until then it prints `SKIPPED` and reports remote status as **unverified**.

The bridge explicitly rejects non-Replit origins, insecure HTTP, redirects and oversized responses. GitHub Actions and Replit both need manual access and provisioning; this pack does not create credentials or GitHub remotes in Replit.

## Required decisions before any automatic code sync

- Choose the long-term runtime and ownership model (existing Replit monorepo vs GitHub React/Vite/Next.js legacy).
- Reconcile Git histories and package manager, avoid pushing unrelated histories to `main`.
- Decide whether to extract a small shared TypeScript contract package with independent versioning, or to migrate selected apps through a reviewed PR.
- Document a single identity authority and migration from Clerk/Auth0; assess user consent and data protection.
- Validate WordPress archive compatibility separately. Never move real user content through development or test fixtures.
- Run accessibility user testing, consent/withdrawal tests, moderation authorisation tests and security checks before publication.

## Trust model

The bridge provides **development coordination**, not a new account system, public forum federation, accreditation service, published CripSquare feature, or production MapAble integration. The contract has draft review status. Replit inspection was read-only; this repository check cannot verify its current running preview. Never claim international standards conformance from the existence of tests or a contract.
