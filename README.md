# SparkPOS

Point-of-sale, inventory, and accounting system for a single electronics retail shop.
Built for the shop owner first; trusted workers later. Low traffic — optimised for
**correctness and ease of use, not scale**.

A complete **manual** POS and inventory system, with an **optional AI layer** added later
(a chatbot over the business data, and conversational sales). The shop runs fully without
the AI; the AI is convenience, never a dependency.

## Docs

- [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) — product spec, domain model, roadmap (start here)
- [`CLAUDE.md`](CLAUDE.md) — working rules + context for Claude Code
- [`docs/specs/`](docs/specs/) — one spec per feature, written before coding
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — architectural decisions log

## Stack

React (Vite) + TypeScript · Node.js + Express + TypeScript · MongoDB + Mongoose · Tailwind +
shadcn/ui · TanStack Query · Zustand · Zod · Recharts · AI (later) via Anthropic Claude
Messages API + tool use.

## Status

Phase 0 — foundations. See the roadmap in `docs/PROJECT_PLAN.md`.