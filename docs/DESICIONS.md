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