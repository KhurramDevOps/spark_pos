# Spec: 003b — Purchase reversals & supplier returns

- **Status:** draft
- **Phase:** Phase 2 — Purchases & cost (recovery net; completes the phase)
- **Author / date:** <you> / <fill in>
- **Builds on:** spec 003 (immutable Purchase; weighted-average cost engine; costAtTime stored
  on every purchase StockMovement; the floored-weighted-average formula; one-txn-per-operation;
  Decimal128 money/qty; the decision that reversals cannot losslessly restore avgCost and that
  replay-from-costAtTime is the true repair path).

## 1. Problem / goal
Right now a posted purchase is immutable and there is no way to undo it — a mistyped purchase
(wrong item, wrong quantity, wrong cost) can only be fixed by restoring the database. That's
unacceptable for real daily use. We need two related capabilities:

1. **Reverse a purchase** — "I entered this wrong / it never happened." Undo a posted
   purchase's effects: take the stock back out, restore the supplier payable, and correct
   avgCost.
2. **Supplier return** — "I'm sending some of this stock back to the supplier" (faulty batch,
   wrong order). Reduce stock for specific items/quantities and reduce what I owe the supplier
   (or record a refund).

Both must correctly reverse the **cached aggregates** (stockQty, avgCost, supplier.balance) —
not merely delete a row — because those numbers have already moved.

## 2. The hard part (read first)
avgCost is a *weighted average*, and you cannot un-average it exactly. If you bought 100 @ ₹110
when you already held 200 @ ₹0, the average became ₹36.67; "removing" that purchase can't be
done by a simple formula because the ₹36.67 has since blended into later purchases too. The
**only correct way** to get avgCost right after any reversal is to **recompute it from the full
purchase history** (replay), using the `costAtTime` we deliberately stored on every purchase
movement. So this spec's avgCost correction is a **replay-from-movements recompute**, not an
inverse formula. Confirm this approach in review — it's the architectural heart of the spec.

## 3. User stories
- As the owner, I want to reverse a purchase I entered wrong, so my stock, average cost, and
  supplier balance all return to where they should be — with a record that the reversal happened.
- As the owner, I want to return some stock to a supplier, so my stock goes down and what I owe
  that supplier (or a refund due) is recorded.
- As the owner, I want reversals/returns to be visible in history (not silent), so the audit
  trail stays honest.

## 4. Scope
**In scope:**
- **Reverse purchase:** mark a purchase reversed; write reversing StockMovements (negative qty,
  type `return` or a new `reversal` type — decide in review); restore supplier.balance if it was
  a credit purchase; recompute avgCost for every affected item by replay.
- **Supplier return:** a new transaction type — pick supplier (required), lines (item, qty to
  return, optionally the cost basis), reduce stock, reduce supplier.balance or record refund;
  recompute avgCost by replay for affected items.
- **Recompute-avgCost-by-replay service** — the shared engine both flows use: for an item,
  walk its purchase/return movements in posting order and re-derive avgCost + a verified stockQty
  from the floored-weighted-average rules in spec 003 §6. This also becomes a general repair tool.
- History surfacing: reversed purchases shown as reversed; returns shown in purchase/supplier
  history.

**Out of scope (explicitly not now):**
- Partial reversal of a purchase (reverse only some lines) — full-purchase reversal only for
  now; a return covers the "some of it" case. Confirm.
- Customer-side returns (that's Phase 3, sales).
- Editing a purchase in place (still immutable; reverse + re-enter is the pattern).

## 5. Data model changes
- **Purchase** — add `reversed` (bool, default false), `reversedAt`, `reversedBy`,
  `reversalOf`/`reversalRef` (link the reversal record) — decide exact shape in review. A
  reversed purchase is NOT deleted (audit).
- **StockMovement** — reversing/return rows use negative qty. Decide: reuse existing `return`
  type, or add a distinct `reversal` type to the enum for clarity (recommend a distinct type so
  "supplier return" and "purchase reversal" are distinguishable in history). Carry costAtTime,
  refId, createdBy as usual.
- **SupplierReturn** (new, if returns are modeled separately from reversals) — supplierId,
  date, lines, total, refundRecorded (bool), createdBy, timestamps. Or model returns as a
  negative-quantity purchase-like document — decide in review (recommend a distinct collection
  for clarity).
- No change to the avgCost field itself; it just gets recomputed.

## 6. Business rules (precise — this is where bugs live)
- **avgCost is always recomputed by replay, never by inverse formula.** After any reversal or
  return, for each affected item: replay its purchase + return movements in posting order
  through the spec 003 §6 floored-weighted-average rules to derive the correct avgCost. This is
  the single source of truth for avgCost correctness.
- **One transaction per operation.** A reversal (movements + supplier balance + avgCost
  recompute + marking the purchase reversed) is one `session.withTransaction`. All-or-nothing.
- **Stock can go negative after a return/reversal** (you may have already sold/used some) —
  allowed, consistent with spec 001's negative-stock decision; surfaced, never blocked. The
  replay must handle negative running quantities via the same flooring rule.
- **Supplier balance effects:**
  - Reverse a *credit* purchase → supplier.balance -= that purchase's total (you no longer owe
    it). If you'd already paid it, this can push the balance negative (an advance) — allowed +
    surfaced.
  - Reverse a *cash* purchase → no supplier balance effect.
  - Supplier return on credit → reduce supplier.balance by the return value; on already-paid →
    record a refund due (balance goes negative / "supplier owes you"). Decide exact handling in
    review.
- **Cannot reverse an already-reversed purchase** (idempotency) — reject with a clear message.
- **Reversal/return is itself immutable and audited** — createdBy + timestamp; it appears in
  history; it cannot be un-reversed by deletion (to undo a reversal, re-enter the purchase).
- **Replay performance:** recompute touches only the items affected by the reversal/return,
  walking each item's own movements — not the whole catalogue. Batch the movement reads.

## 7. Validation rules
- Reverse: purchase must exist and not already be reversed.
- Return: supplierId required; ≥ 1 line; per line item exists, qty Decimal128 > 0; return qty
  per item should not exceed what's sensible — decide whether to cap at current stock or allow
  (recommend allow + surface, consistent with negative stock).
- createdBy required on every reversal/return and its movements.
- Shared Zod schemas, same conventions as prior specs.

## 8. Acceptance criteria (checklist)
- [ ] Reversing a cash purchase removes its stock and recomputes avgCost by replay to the
      correct value (verified: post two purchases, reverse the second, assert avgCost matches a
      from-scratch replay of just the first).
- [ ] Reversing a credit purchase also restores supplier.balance correctly (incl. the
      already-paid → advance case).
- [ ] A supplier return reduces stock and supplier balance/refund correctly, with avgCost
      recomputed by replay.
- [ ] Replay-recompute produces the SAME avgCost as if the reversed/returned movements had
      never existed — proven with a worked example (e.g. 200@₹0 + 100@₹110 → ₹36.67; reverse
      the ₹110 buy → back to ₹0).
- [ ] Reversal/return is one transaction: forced mid-operation failure persists nothing.
- [ ] Reversing an already-reversed purchase is rejected.
- [ ] Stock going negative after a return is allowed and surfaced, not blocked.
- [ ] Reversed purchases and returns are visible in history (not silent).
- [ ] Works fully through the UI with no AI.
- [ ] Tests cover: replay correctness vs from-scratch, credit-balance restoration (incl.
      already-paid), supplier return math, atomicity, idempotency (no double-reverse), and the
      negative-stock-after-return path.

## 9. Open questions for the owner / review
1. **Movement type:** reuse `return` or add a distinct `reversal` type to the StockMovement enum
   for clarity? (Recommend distinct, so reversals vs supplier-returns are readable in history.)
2. **Returns modeling:** separate `SupplierReturn` collection (recommend) vs negative
   purchase-like doc?
3. **Partial purchase reversal:** full-only now, use returns for partials — confirm.
4. **Already-paid reversal/return → refund:** push supplier balance negative ("advance/refund
   due") and surface, vs a separate refund record? (Recommend balance-negative + surface,
   consistent with spec 003 Q5.)
5. **Return qty cap:** allow returns that drive stock negative (recommend, consistent) or cap at
   current stock?
6. **Should the replay-recompute be exposed as a manual "recalculate cost" repair button**
   anywhere (admin/debug), since it's a general integrity tool? (Optional; nice safety valve.)

## 10. Notes / decisions
- This spec exists because spec 003 made purchases immutable; replay-from-costAtTime was named
  there as the true repair path — this implements it.
- The replay-recompute service is the reusable core; both reverse and return call it. Do not
  write a second avgCost path.
- Record decisions (movement type, returns modeling, refund handling) in DECISIONS.md.
- After this ships, purchasing is safe for real daily use (mistakes are recoverable in-app).