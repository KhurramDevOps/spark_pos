# Spec: 004b — Customer returns & sale void

- **Status:** in-progress (review complete; building models + services + tests first)
- **Phase:** Phase 3 — Sales / POS (recovery net; completes the sell side)
- **Author / date:** <you> / <fill in>
- **Builds on:** spec 004 (immutable Sale; costAtTime snapshot per line; sale = qty-only,
  never recomputes avgCost; Customer khata; the deferred Q1 decision to bundle void+return
  into one model); spec 003b (the immutability + reversal pattern, and the confirmed insight
  that sale reversal is LIGHTER than purchase reversal — no replay needed).

## 1. Problem / goal
Right now a posted sale is immutable with no way to undo it. Two real situations need a fix:

1. **Sale void** — "I entered this wrong / it never happened" (wrong item, wrong qty, wrong
   customer). Undo the whole sale.
2. **Customer return** — "the customer brought some of this back" (faulty item, wrong size) —
   confirmed frequent. Put stock back for specific lines/quantities and refund cash or credit
   the customer's khata.

Both must correctly reverse stock and the cash/khata effect of the original sale, with a
visible audit trail (not silent deletion).

## 2. Why this is lighter than spec 003b (read first)
003b was hard because avgCost is a weighted average and undoing a purchase meant replaying the
item's whole cost history. **Sales don't have that problem.** A sale never changes avgCost — it
only snapshots cost (read-only) and decrements stock. So reversing a sale or a return is just:
**put the stock back, and undo the cash/khata effect.** No replay engine, no recompute, no
exclusion-from-cost-history machinery. Confirm this in review and resist the urge to reuse the
003b replay code here — it would be solving a problem that doesn't exist on the sale side.

The one thing that DOES need care: **profit reversal.** If a sale recorded +₹1,300 profit and
it's voided/returned, that profit must be correctly removed from whatever profit reporting
exists or will exist (Phase 6) — by marking the sale/line as voided/returned so reports can
exclude it, not by deleting the row (audit).

## 3. User stories
- As the owner, I want to void a sale I entered wrong, so stock and the customer's khata (or
  cash) return to where they should be, with a clear record that it happened.
- As the owner, I want to record a customer bringing back some of what they bought, so stock
  goes back up and they get a refund (cash) or a khata credit (if it was on credit / they want
  store credit).
- As the owner, I want voided sales and returns visible in history (not silently gone).

## 4. Scope
**In scope:**
- **Void sale:** mark a posted sale void; write reversing StockMovements (positive qty back in,
  type `reversal`, costAtTime carried for audit but NOT used to recompute avg); if it was
  credit, reduce the customer's khata balance by the sale total; if cash, just a record (no cash
  movement to reverse automatically — owner physically returns cash, system just logs it
  happened). Decide cash-refund handling precisely in review.
- **Customer return:** new transaction — pick the original sale (or just customer + item, if a
  standalone return is allowed — decide in review), lines (item, qty returned), increases stock,
  and either refunds cash or reduces khata (if it was a credit sale) or grants khata credit.
- **Reuse, don't reinvent:** the SAME shape of work as supplier returns from 003b (a return
  collection, qty back into stock, balance effect) — mirror `SupplierReturn` → `CustomerReturn`
  structurally, NOT the replay logic (see §2).
- History surfacing: voided sales marked (badge, like the Purchase "Reversed" badge); returns
  shown in sale/customer history.

**Out of scope:**
- Partial void of a sale (void only some lines) — full-sale void only; returns handle the
  partial case. Mirrors 003b's purchase-reversal-is-full-only decision.
- Restocking faulty/damaged goods differently from resellable goods (e.g. a "damaged, write off"
  path) — out for now; a return always puts stock back at face value. Flag as a future
  refinement if the shop needs to distinguish.
- Receipts (still deferred per spec 004).

## 5. Data model changes
- **Sale** — add `voided` (bool, default false), `voidedAt`, `voidedBy`. Not deleted (audit).
- **StockMovement** — POSITIVE qty (stock back in). **Sale void → type `reversal`**; **customer
  return → type `return`** (mirrors 003b's reversal-vs-return distinction so they read apart in
  history). `costAtTime` carried from the original line for audit symmetry only (never feeds a
  recompute). `refId = sale._id`, `createdBy`. **`reversalRef` is left UNSET** — that field is
  the 003b purchase-cost exclusion trigger (costService auto-excludes any `reversalRef`); it has
  no meaning on the sale side and must not be set (ADR-008).
- **CustomerReturn** (new, mirrors SupplierReturn structurally) — **saleId (ref Sale, REQUIRED**
  — standalone returns not allowed, §9.1), customerId (**required only when refundMethod =
  khata-credit**, §9.3), date, lines [{ itemId, qty (Decimal128 > 0), valueAtTime (Decimal128 =
  the original sale line's unitPrice — what the customer paid, the refund/credit value per unit) }],
  total (whole paisa = Σ qty·valueAtTime), refundMethod (enum: cash | khata-credit), note,
  createdBy, timestamps.
- No change to Item or the cost engine. **avgCost is untouched, and replay is NOT called** by
  anything in this spec (the +q reversal/return movement and the original −q sale movement are
  both qty-only and cancel, so `recalculate-cost` still reports no drift).

## 6. Business rules
- **Stock only, no replay.** Voids/returns increase stockQty directly in the same transaction
  as the movement write. avgCost is never read or written by this spec's flows.
- **One transaction per operation**, same atomicity discipline as every prior spec.
- **Void effect on khata:** voiding a credit sale → customer.balance -= sale.total (they no
  longer owe it). If they'd already paid against it, this can push balance negative (store
  credit / refund due) — allow + surface, consistent with every prior balance decision.
- **Void effect on cash:** voiding a cash sale has no balance effect (no customer ledger
  involved); it's a record that the sale is cancelled and its stock is restored. Decide: does the
  owner need an explicit "cash refunded" acknowledgment step, or is voiding enough? (Lean:
  voiding is enough; cash changing hands physically is outside the system, same as a purchase's
  cash payment isn't separately confirmed.)
- **Return refund method:** if the original sale was credit, default refundMethod = khata-credit
  (reduces what they owe, or grants credit if already settled); if cash, default = cash (a
  record, no balance effect) but allow choosing khata-credit instead (e.g. "keep it as credit
  for next time" — common in shops). Confirm this flexibility is wanted.
- **Cannot void an already-voided sale** (idempotency) — reject clearly.
- **Return quantity cap (CUMULATIVE, §9.4):** a return's qty for an item, PLUS all prior
  returns against the same `saleId` for that item, must not exceed the qty sold on that sale
  line. (Per-return-only would let the full qty be returned repeatedly.) One query by `saleId`.
- **Refund method (§9.3):** `refundMethod = cash` → a record only, no balance effect, no
  customer needed. `refundMethod = khata-credit` → REQUIRES a customerId, and
  `customer.balance -= total` (reduces what they owe, or goes negative = store credit; surfaced).
- **Voids/returns are themselves immutable and audited** — createdBy + timestamp, visible in
  history, never themselves un-done by deletion (to undo a void, re-enter the sale).
- **Stock after a return is just addition** — no negative-stock interaction to worry about here
  (returns only add stock back).

## 7. Validation rules
- Void: sale must exist, not already voided.
- Return: customerId required; ≥1 line; qty Decimal128 > 0 per line; if linked to a sale,
  validate item was actually on that sale (and optionally cap qty at what was sold — decide).
- createdBy required everywhere.
- Reuse shared validators (objectId, positiveDecimalString, money).

## 8. Acceptance criteria (checklist)
- [ ] Voiding a cash sale restores stock for every line; sale shows "Voided" badge in history.
- [ ] Voiding a credit sale also restores stock AND reduces the customer's khata balance by the
      sale total (incl. the already-paid → store-credit case).
- [ ] A customer return increases stock for the returned lines and applies the chosen refund
      method (cash record vs khata credit) correctly.
- [ ] avgCost is UNCHANGED by any void or return (regression-check against the cost engine —
      confirm no replay/recompute is triggered).
- [ ] Void/return is one transaction: forced mid-operation failure persists nothing.
- [ ] Voiding an already-voided sale is rejected.
- [ ] Voided sales and returns are visible in sale + customer history (not silent).
- [ ] Works fully through the UI with no AI.
- [ ] Tests cover: void-restores-stock, void-reduces-khata (incl. advance/store-credit case),
      return math (stock + refund/credit), atomicity, idempotency, avgCost-untouched regression.

## 9. Decisions (resolved in review; see ADR-008)
1. **Standalone returns:** NOT allowed — every return REQUIRES a linked `saleId`. ✅
2. **Cash-refund acknowledgment:** the void/return record itself is enough; no separate step. ✅
3. **Refund method:** a cash sale's return may be refunded as **cash (default) or khata-credit**
   (owner's choice). khata-credit requires a customer (pick/create one if the cash sale had none)
   and moves `customer.balance`. ✅
4. **Cap return qty:** ENFORCE, cumulatively across prior returns on the same sale line. ✅
5. **Void UI:** in the single-sale detail view (mirrors PurchaseDetail's reverse button); return
   form launched from the same sale detail (linked, pre-filled). ✅

## 10. Notes / decisions
- This is the last piece of Phase 3's safety net. After this ships, the sell side (like the
  purchase side after 003b) is safe for real daily use: every kind of sale mistake is
  recoverable in-app.
- Reuse relentlessly: CustomerReturn mirrors SupplierReturn structurally; the void flow mirrors
  the Purchase reverse flow's UI pattern (confirm dialog, disabled-once-done, badge in history) —
  but the SERVICE logic is simpler (no replay) per §2.
- Record decisions (standalone-returns-allowed-or-not, refund-method flexibility, void-no-replay)
  in DECISIONS.md.
- Build order: model changes + void service + return service with the full test list FIRST,
  PAUSE for green, then routes, then UI (void button in sale detail; return form in customer
  detail or sale detail — decide placement in review).