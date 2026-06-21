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

## ADR-004 — CSV bulk import: insert-only, two-phase with a server stash, locked headers
- Date: 2026-06-20
- Status: accepted
- Context: Spec 002 adds bulk item import from a spreadsheet — the main bottleneck to cataloguing
  the real shop. Several choices here are expensive to reverse once owners have prepared files
  and run imports against a live catalogue.
- Decision:
  - **CSV only**, parsed server-side with **papaparse** (the one approved new dependency). The
    browser POSTs the file's raw text as a `text/csv` body — **no multipart upload library**
    (e.g. multer). `.xlsx`/SheetJS deferred.
  - **Insert-only.** A row whose SKU already exists (active or inactive) is an error/skip, never
    an update. Update-on-collision is a one-way door (workflows would come to depend on it); an
    opt-in update mode with a per-field-diff preview can be added later without breaking anyone.
  - **Two-phase preview → commit via a short-lived in-memory server stash keyed by a random
    import token (+ TTL).** Commit sends only the token; the server re-reads and re-validates the
    stashed upload — it never trusts a client-echoed preview. The durable audit record is the
    `ImportLog`, not the stash.
  - **Preview never writes and never burns the SKU counter.** Auto-SKUs are generated (atomic
    per-prefix counter, ADR per spec 001 §9.2) **only at commit**; preview shows `(auto)`. A test
    asserts the `Counter` collection is unchanged after a preview. (Burning numbers in preview
    would leave permanent gaps and make previewed SKUs mismatch committed ones.)
  - **Locked template headers** (exact strings): `name, categoryName, baseUnit, retailPrice,
    wholesalePrice, reorderLevel, openingStock, sku`. Required: the first four. Matching is
    case-insensitive/trimmed with a leading BOM stripped. Renaming them breaks owners' saved
    files, so they are fixed.
  - **New `ImportLog` collection** (filename, createdBy, counts, error report, timestamp), one
    document per commit — the only audit trail for an operation with no per-item undo.
  - Categories referenced by name are auto-created **up front** (before any row transaction),
    deduped case-insensitively including within the file; prefix via existing `deriveSkuPrefix()`
    with no special collision handling. Money: rupees→paisa (`×100`), **reject >2 decimal places
    and any separators/symbols** (never round money). Cap **10,000 rows / 10 MB**. Commit is a
    loop of per-row transactions over the existing `createItem()` service. Import is **owner-only**.
- Consequences: Simpler, safer first version (pure inserts, no merge semantics, no interaction
  with `baseUnit` immutability). The stash makes the server briefly stateful between the two
  calls (bounded by TTL + size cap; lost on restart → owner re-uploads). Per-row transactions
  cost throughput but keep each row atomic and reuse tested code. Adding update mode or `.xlsx`
  later is additive.

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