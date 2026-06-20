# Decisions Log

Short, append-only record of architectural decisions. One entry per decision. Newest on top.

Format:

```
## ADR-NNN — <title>
- Date:
- Status: accepted | superseded by ADR-MMM
- Context: what forced a choice
- Decision: what we chose
- Consequences: trade-offs, what this rules out
```

---

## ADR-003 — MongoDB runs as a replica set (transactions); decimal precision split
- Date: 2026-06-20
- Status: accepted
- Context: Golden rule #3 requires multi-document transactions
  (`session.withTransaction`) for any write spanning stock + ledger + COGS. MongoDB only
  supports transactions on a **replica set** (or mongos) — a standalone `mongod` throws. Spec
  001 also moved quantities to Decimal128 (wire/cable/copper sell in fractional gaz/meter/kg).
- Decision:
  - **Run MongoDB as a replica set in every environment.** Local dev = a single-node set `rs0`
    (`replSetName: rs0` in `mongod.conf`, one-time `rs.initiate()` — automated via
    `backend/src/scripts/initReplicaSet.js`, i.e. `npm run rs:init`). Tests connect to `rs0`.
    Production = MongoDB Atlas (always a replica set). Steps documented in `backend/README.md`.
  - **Money/precision split:** retail/wholesale prices stay integer **paisa**; `avgCost`,
    `costAtTime`, and all **quantities** (`stockQty`, StockMovement `qty`) are **Decimal128**.
    The small bit of quantity arithmetic (adjustment delta) uses an exact BigInt helper
    (`backend/src/lib/decimal.js`) rather than adding a decimal-math dependency. No floats.
- Consequences: Local setup has one extra one-time step (initiate the set) — scripted, so it's
  cheap. Tests require a running replica set. Decimal128 over JSON is transmitted as strings to
  avoid float coercion. Keeps transactions and exact money/stock math available from day one.

## ADR-002 — AI via Anthropic Messages API + tool use (not OpenAI, not Agent SDK yet)
- Date: <fill in>
- Status: accepted
- Context: Need a chatbot + conversational sales. Already using Claude Code / Anthropic.
- Decision: Use Claude (Anthropic). Start with the plain Messages API + tool-use loop with a
  small fixed set of tools. Defer the Claude Agent SDK unless workflows become open-ended.
- Consequences: Simpler, cheaper, easier to debug. One ecosystem. Re-evaluate if needs grow.

## ADR-001 — MERN stack (MongoDB, Express, React, Node), with disciplined transactions
- Date: <fill in>
- Status: accepted
- Context: Developer already knows MERN — shipping with a known stack beats a theoretically
  "purer" one. Inventory + accounting data is transactional: a sale must update stock, ledger,
  and COGS together or not at all.
- Decision: MongoDB + Mongoose. Every service function writing to more than one collection
  must use a MongoDB multi-document transaction (`mongoose.startSession()` +
  `withTransaction`). This rule is non-negotiable and is enforced in code review / spec
  acceptance criteria, not left to convention.
- Consequences: Faster initial development (familiar stack). Slightly more manual discipline
  required than a relational DB with built-in ACID guarantees — the transaction rule exists
  specifically to close that gap. TypeScript + Zod added to catch the bugs Mongo's flexible
  schema would otherwise let through.