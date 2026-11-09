# CripSquare: Cursor + Replit UX Development Bridge

**Working bridge, not a production deployment.** The full technical guide is `docs/bridge/README.md`.

## Purpose

Coordinate Australian Disability Ltd's CripSquare community user journeys and MapAble Signal from two currently different development apps. Use a versioned UX contract with testable accessibility and consent requirements. Do not mirror entire source trees or merge the unrelated authentication and database systems.

## What is implemented

- A structured journey contract for Village Square, communities, forums, stories, resources, events, display preferences, safety/reporting and MapAble Signal.
- Source-inspection baseline snapshots for the existing GitHub and Replit apps, preserving known differences and gaps.
- Offline TypeScript/JavaScript route and snapshot drift check with Markdown/JSON audit report.
- GitHub Actions PR gate, optional scheduled read-only Replit development contract handshake, Cursor rules and joint agent instructions.
- Deterministic Node tests for safety and status reporting.

## Quick start (Node 22+)

Run in this package:

```bash
node --test tests/bridge/contract.test.mjs
node scripts/bridge/check-contract.mjs --strict --out out/ux-report.md
```

To integrate into `ausdisau/CripSquare` place the contents of this package at repository root on a new feature branch, then run:

```bash
node scripts/bridge/check-contract.mjs --repo . --strict --out out/ux-report.md
```

The second command reads the real GitHub Vite route declarations. A standalone run checks captured snapshots **only**.

## Provenance and blockers

The inspected GitHub `CripSquare` and Replit `CeipSquare` apps have different codebases and identity systems. Replit has no configured `ausdisau/CripSquare` remote. Actual Replit file/code parity, user-interface parity and WCAG conformance have not been verified. Never treat a passing contract check or a matching fingerprint as a completed integration.

No production data, account information, sensitive disability information, secrets or publishing actions are part of this bridge.
