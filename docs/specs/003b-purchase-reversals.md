# Spec: 003b — Purchase reversals & supplier returns

- **Status:** approved (review complete; building tests-first per §11)
- **Phase:** Phase 2 — Purchases & cost (recovery net; completes the phase)
- **Author / date:** owner + Claude / 2026-06-22
- **Builds on:** spec 003 (immutable Purchase; weighted-average cost engine; `costAtTime` stored
  on every purchase StockMovement; the floored-weighted-average formula; one-txn-per-operation;
  Decimal128 money/qty; the decision that reversals cannot losslessly restore avgCost and that
  replay-from-`costAtTime` is the true repair path). See ADR-006.

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

Both must correctly reverse the **cached aggregates** (`stockQty`, `avgCost`, `supplier.balance`) —
not merely delete a row — because those numbers have already moved. The correction of `avgCost`
is always done by **replay** (see §2), not by an inverse formula.

## 2. The hard part (read first — this is the architectural heart)
`avgCost` is a *weighted average*, and you cannot un-average it exactly. If you bought 100 @ ₹110
when you already held 200 @ ₹0, the average became ₹36.67; "removing" that purchase can't be done
by a simple formula because the ₹36.67 has since blended into later purchases too. The **only
correct way** to get `avgCost` right after any reversal is to **recompute it from the item's full
movement history (replay)**, using the `costAtTime` we deliberately stored on every purchase
movement.

**Replay rule (precise — the rest of the spec depends on it):**

> To replay an item, walk **all of its StockMovements in posting order** — `purchase`,
> `adjustment` (incl. opening stock), `sale`, `return`, `reversal` — maintaining a running
> `(stockQty, avgCost)` starting from `(0, 0)`.
> - At a **`purchase`** movement (the only cost-bearing event): recompute the average with the
>   spec 003 §6 floored-weighted-average rule, i.e. `applyPurchaseToCost(runQty, runAvg, mv.qty,
>   mv.costAtTime)`.
> - At **every other movement type**: apply the signed `qty` to the running stock and **leave
>   `avgCost` unchanged**.

Walking **all** movement types is non-negotiable: the original engine computed each purchase's
average from the *live* `stockQty`, which already reflects opening stock, adjustments and (later)
sales. The canonical ₹36.67 case proves it — the "200 @ ₹0" opening is an `adjustment` movement,
not a purchase. If replay walked only purchase movements it would see `oldQty = 0` and wrongly
compute ₹110. (An earlier draft of this spec said "purchase + return only" — that was wrong and
is corrected here.) A worked counter-example with an intervening stock-out:
`100 @ ₹10 → adjust −60 → 100 @ ₹20` gives the correct **₹17.14** only because replay carries the
−60 into the running quantity; purchase-only replay would give ₹15.00.

## 3. User stories
- As the owner, I want to reverse a purchase I entered wrong, so my stock, average cost, and
  supplier balance all return to where they should be — with a record that the reversal happened.
- As the owner, I want to return some stock to a supplier, so my stock goes down and what I owe
  that supplier (or a refund due) is recorded.
- As the owner, I want reversals/returns to be visible in history (not silent), so the audit
  trail stays honest.
- As the owner, I want an owner-only "recalculate cost" repair action, so I can re-derive an
  item's avgCost/stockQty from its movement history if I ever suspect drift.

## 4. Scope
**In scope:**
- **Recompute-avgCost-by-replay service** (`recomputeItemCostByReplay`) — the shared engine all
  flows use: for an item, walk **all** its movements in posting order per §2, re-derive
  `avgCost` and a verified `stockQty`. Returns both as decimal strings; **does not write**. This
  is also the general repair tool. Built and proven FIRST (§11).
- **Reverse purchase:** mark the purchase `reversed`; write reversing StockMovements (negative
  qty, `type: "reversal"`) linked to the purchase via `reversalRef`; restore `supplier.balance`
  if it was a credit purchase; recompute `avgCost`/`stockQty` for every affected item by replay
  **excluding the reversed purchase's movements and their reversing pair** (§6).
- **Supplier return:** a new `SupplierReturn` document — pick supplier (required), lines (item,
  qty to return), reduce stock via `type: "return"` movements (carrying
  `costAtTime = current avgCost`), reduce `supplier.balance` or record a refund-due; recompute by
  replay for affected items (note: a return does **not** change avgCost at the moment it happens
  — see §6).
- History surfacing: reversed purchases shown as reversed; returns shown in purchase/supplier
  history.
- Owner-only "recalculate cost" repair action calling the replay service and writing the result
  back (with a drift report).

**Out of scope (explicitly not now):**
- Partial reversal of a purchase (reverse only some lines) — **full-purchase reversal only**; a
  return covers the "some of it" case. (Confirmed.)
- Customer-side returns (that's Phase 3, sales).
- Editing a purchase in place (still immutable; reverse + re-enter is the pattern).

## 5. Data model changes
- **Purchase** — add `reversed` (bool, default false), `reversedAt` (Date), `reversedBy`
  (ObjectId ref User), `reversalRef` (ObjectId — the reversal record / batch id). A reversed
  purchase is **never deleted** (audit).
- **StockMovement**:
  - Enum gains a distinct **`reversal`** type (kept separate from `return` so purchase-reversals
    and supplier-returns are distinguishable in history). Reversing rows use **negative qty** and
    carry `costAtTime`, `createdBy` as usual.
  - New optional field **`reversalRef`** (ObjectId) — on a reversing row, points at the reversed
    purchase so replay can filter the original+reversing **pair** together.
  - New compound index **`{ itemId: 1, createdAt: 1, _id: 1 }`** — the exact key replay reads by.
  - `return` rows carry **`costAtTime` = the item's current `avgCost`** at return time (valuation
    symmetry; stock leaves at the average it was carried at).
- **SupplierReturn** (new collection) — `supplierId` (required), `date`, `lines: [{ itemId, qty
  (Decimal128 > 0), costBasis (Decimal128 = avgCost at return) }]`, `total` (whole paisa),
  `refundDue` (bool — true when the supplier was already paid), `note`, `createdBy`, timestamps.
- No change to the `avgCost` field itself; it just gets recomputed.

## 6. Business rules (precise — this is where bugs live)
- **avgCost is always recomputed by replay, never by inverse formula**, per the §2 rule. This is
  the single source of truth for avgCost correctness. The replay service reuses
  `applyPurchaseToCost` **verbatim** (scale 10, half-even, from `(0,0)`) — there is exactly one
  avgCost code path.
- **Ordering key is `(createdAt asc, _id asc)` — never `purchase.date`.** `purchase.date` is a
  user label that must not reorder cost history (ADR-005). `_id` is the tiebreak for movements
  sharing a `createdAt` (e.g. two same-item lines of one purchase, inserted in one ordered bulk
  write — `_id` preserves insertion order).
- **Reversal = exclude, don't subtract.** You cannot feed a negative quantity into the forward
  average formula (un-averaging is undefined — that's §2). To reverse purchase `P`, replay each
  affected item **excluding every movement whose `refId === P._id` OR `reversalRef === P._id`**
  (the original purchase rows and their reversing rows cancel and are both dropped), and recompute
  from the survivors. The reversing rows still exist for the **stock ledger + audit**; they are
  simply not fed to the average.
- **costAtTime guard.** Replay **throws** if any `purchase` movement it consumes is missing
  `costAtTime` or has a negative one. A cost-bearing movement with no cost is corruption, surfaced
  loudly, never silently treated as 0.
- **Drift detector.** Replay returns a recomputed `stockQty`; the caller compares it to the
  cached `stockQty`. The repair tool reports/repairs drift; reverse/return flows assert the
  post-operation stock matches the expected value.
- **One transaction per operation.** A reversal (reversing movements + supplier balance + avgCost
  recompute write + marking the purchase reversed) is one `session.withTransaction`. A return
  (return movements + supplier balance/refund + recompute write + SupplierReturn doc) is one
  transaction. All-or-nothing.
- **Stock may go negative after a return/reversal** (you may have already sold/used some) —
  allowed, consistent with spec 001; surfaced, never blocked. Replay's flooring rule handles the
  negative running quantity.
- **Returns do not change avgCost at the moment of return.** Under weighted-average, returned
  units leave at the **current average**, so the average is unchanged; only the running quantity
  drops (which affects *future* purchases via flooring). The `return` movement records
  `costAtTime = current avgCost` for valuation symmetry. (Replay still produces the correct
  number because the reduced running quantity flows into later purchase events.)
- **Supplier balance effects:**
  - Reverse a **credit** purchase → `supplier.balance -= purchase.total`. If already paid, this
    pushes the balance negative (an advance / refund due) — allowed + surfaced.
  - Reverse a **cash** purchase → no supplier balance effect.
  - Supplier **return** → reduce `supplier.balance` by the return value; if the balance would go
    negative (already paid), that **negative balance is the "refund due"**, surfaced as
    "advance / supplier owes you" (consistent with ADR-005 / spec 003 Q5). `refundDue` flagged on
    the SupplierReturn.
- **Cannot reverse an already-reversed purchase** (idempotency) — reject with a clear message.
- **Reversal/return is itself immutable and audited** — `createdBy` + timestamp; appears in
  history; cannot be un-reversed by deletion (to undo a reversal, re-enter the purchase).
- **Replay performance:** recompute touches only the items affected by the reversal/return,
  walking each item's own movements via the compound index — not the whole catalogue.

## 7. Validation rules
- Reverse: purchase must exist and not already be `reversed`.
- Return: `supplierId` required; ≥ 1 line; per line item exists, `qty` Decimal128 > 0. Return qty
  is **not capped at current stock** — returns that drive stock negative are allowed + surfaced
  (consistent with the negative-stock decision).
- `createdBy` required on every reversal/return and its movements.
- Shared Zod schemas, same conventions as prior specs (rupees→paisa at the boundary).

## 8. Acceptance criteria (checklist)
- [ ] **Replay parity:** for a sequence of purchases, `recomputeItemCostByReplay` returns the
      SAME `avgCost`/`stockQty` the incremental engine stored. *(test-first, §11)*
- [ ] **Canonical:** 200 @ ₹0 opening (adjustment) + 100 @ ₹110 → replay = ₹36.67; replay
      excluding the ₹110 purchase → ₹0 / 200. *(test-first)*
- [ ] **Mixed movements:** purchase → adjustment(−) → purchase replays to **₹17.14** (not the
      purchase-only ₹15.00), proving all movement types feed the running quantity. *(test-first)*
- [ ] **Ordering:** replay sorts by `(createdAt, _id)`; a back-dated `purchase.date` does not
      change the result; same-`createdAt` lines order by `_id`. *(test-first)*
- [ ] **Negative flooring:** a stock-out before a purchase floors `oldQty` to 0 in replay. *(test-first)*
- [ ] **Drift detector:** replay's recomputed `stockQty` equals the cached `stockQty`. *(test-first)*
- [ ] **costAtTime guard:** a purchase movement missing `costAtTime` makes replay throw. *(test-first)*
- [ ] Reversing a cash purchase removes its stock and recomputes avgCost by replay to the
      correct value.
- [ ] Reversing a credit purchase also restores `supplier.balance` (incl. already-paid → advance).
- [ ] A supplier return reduces stock and supplier balance/refund correctly; avgCost unchanged
      at return time, future-correct via replay.
- [ ] Reversal/return is one transaction: forced mid-operation failure persists nothing.
- [ ] Reversing an already-reversed purchase is rejected.
- [ ] Stock going negative after a return is allowed and surfaced, not blocked.
- [ ] Reversed purchases and returns are visible in history (not silent).
- [ ] Owner-only "recalculate cost" repair tool works and reports drift.
- [ ] Works fully through the UI with no AI.

## 9. Decisions (formerly open questions — all resolved in review; see ADR-006)
1. **Movement type:** add a **distinct `reversal`** type; keep `return` separate. ✅
2. **Returns modeling:** **separate `SupplierReturn` collection** (not a negative purchase doc). ✅
3. **Partial purchase reversal:** **full-only** now; use returns for partials. ✅
4. **Already-paid reversal/return → refund:** **balance goes negative ("advance / refund due") +
   surface**; `refundDue` flag on the return. No separate refund-payment record now. ✅
5. **Return qty cap:** **allow** returns that drive stock negative (surface, don't block). ✅
6. **Expose replay as a manual "recalculate cost" repair tool:** **yes, owner-only.** ✅

## 10. Notes / decisions
- This spec exists because spec 003 made purchases immutable; replay-from-`costAtTime` was named
  there (ADR-005) as the true repair path — this implements it.
- The replay-recompute service is the reusable core; reverse, return, and the repair tool all call
  it. **Do not write a second avgCost path.**
- Decisions recorded in **ADR-006** (DECISIONS.md): replay walks all movement types / recompute
  at purchase events only; ordering key `(createdAt, _id)`; exclude-don't-subtract reversal;
  return-at-current-avg; costAtTime guard; distinct `reversal` type; `SupplierReturn` collection.
- After this ships, purchasing is safe for real daily use (mistakes are recoverable in-app).

## 11. Build order (tests-first — PAUSE point)
1. **`recomputeItemCostByReplay` + its 7 tests FIRST** (the §8 *test-first* items), proving replay
   matches a from-scratch calculation — especially the mixed-movements **₹17.14** case and the
   canonical **₹36.67 → ₹0**. **PAUSE and show replay green before any reverse/return flow or UI.**
2. Then: reverse-purchase flow (+ tests: credit-balance restoration incl. already-paid,
   atomicity, idempotency).
3. Then: supplier-return flow (+ tests: return math, refund-due, negative-stock-after-return).
4. Then: history surfacing + owner-only repair tool + UI.
