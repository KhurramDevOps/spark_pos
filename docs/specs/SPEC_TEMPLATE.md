# Spec: <NNN> — <Feature name>

> Copy this file to `docs/specs/NNN-feature-name.md` and fill it in **before** writing code.
> Ask Claude Code to review and surface open questions first. Keep it short and concrete.

- **Status:** draft | reviewed | in-progress | done
- **Phase:** (see roadmap in PROJECT_PLAN.md)
- **Author / date:**

## 1. Problem / goal
One or two sentences. What does the owner need to do that they can't do now?

## 2. User stories
- As the owner, I want to … so that …
- As a worker (later), I want to … so that …

## 3. Scope
**In scope:**
- …

**Out of scope (explicitly not now):**
- …

## 4. UI / flow
Describe the screen(s) and the step-by-step flow. Rough sketch in words is fine.
Cover the unhappy paths too (validation errors, returns, overrides).

## 5. Data model changes
New/changed tables, columns, relations. Note any migration concerns.

## 6. Business rules (be precise — this is where bugs live)
- Money handling (units, rounding):
- Stock effects (what moves, in which transaction):
- COGS / valuation impact:
- Edge cases (returns, partial payment, discount, zero stock, negative input):

## 7. Validation rules
Per field: required, type, min/max, format. (These become the Zod schema.)

## 8. Acceptance criteria (checklist)
- [ ] …
- [ ] All money/stock writes spanning more than one collection use a MongoDB transaction
- [ ] Tests cover the money/stock logic
- [ ] Works fully through the UI with no AI

## 9. Open questions for the owner
- …

## 10. Notes / decisions
Anything chosen along the way worth recording in DECISIONS.md.