# Australian Disability Ltd / CripSquare engineering instructions

CripSquare is the community conduit of Australian Disability Ltd; MapAble Signal is the source-aware accessibility mapping workflow, not an automatic forum-to-evidence converter.

Before changing member journeys, read docs/bridge/ux-contract.v1.json and docs/bridge/README.md. Keep public content and private account, location, support and diagnosis data separate. Do not merge identity providers or replace the Replit monorepo with the different GitHub repo. Do not deploy or change production without explicit approval.

For every affected flow, update its observed snapshot after directly checking the current implementation and write down the source revision. The TypeScript code, test reports and reviewed PR are authoritative implementation evidence; a snapshot alone is not.

Minimum participant protections: keyboard, screen reader, AAC and switch interaction, visible focus, plain language, clear error recovery, optional disclosure, accessible non-map alternative, revocable consent and human help. Target WCAG 2.2 AA and ATAG 2.0 authoring behaviour; do not claim conformance without independent manual tests.

Accessibility evidence: never promote Unknown to Green. Flag assumptions, stale evidence and disputes, keep Not Applicable distinct, never imply accreditation or universal-access guarantees. No personal data, production accounts or live mapping submissions in previews, tests or screenshots.

Contributions from Cursor and Replit must go through separate development branches and reviewed diffs; do not auto-merge, force-push, auto-publish or write to shared production data. Replit's current remote is not ausdisau/CripSquare; contract parity is not code parity.
