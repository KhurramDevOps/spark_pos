# Spec: 003 — Purchases & weighted-average cost

- **Status:** draft
- **Phase:** Phase 2 — Purchases & cost
- **Author / date:** <you> / <fill in>
- **Builds on:** spec 001 (Item.avgCost as Decimal128; StockMovement with `purchase` type
  already in the enum; costAtTime as Decimal128; rs0 transactions; per-operation transaction
  rule).

## 1. Problem / goal
Record stock coming IN — what was bought, how much, and at what cost — so that (a) stock goes
up and (b) each item's **weighted-average cost (avgCost)** stays correct. This is the data
that makes real profit possible later (Phase 3: profit = sales − COGS, and COGS reads
avgCost). Most purchases are cash-on-the-spot; supplier tracking is optional and only used when
the owner buys on credit or repeatedly from the same supplier.

**No sales/COGS-on-sale in this spec** — that's Phase 3. Here we only get cost data correct.

## 2. User stories
- As the owner, I want to record a purchase (one or more items, each with quantity and the cost
  I paid), so stock increases and my average cost updates — without needing to name a supplier
  for a quick cash buy.
- As the owner, I want to optionally attach a supplier to a purchase, so that when I buy from
  the same supplier often, or owe them money, it's tracked.
- As the owner, I want to mark a purchase as paid (cash) or on credit, so that when it's
  credit, the amount I owe that supplier is recorded.
- As the owner, I want to record a payment to a supplier later, so the balance I owe them goes
  down.
- As the owner, I want to see what I currently owe each supplier, so I know my outstanding
  payables.

## 3. Scope
**In scope:**
- **Purchase** entry: date, optional supplier, payment type (cash | credit), one or more lines
  (item, quantity, unit cost paid), optional note. Totals computed, not typed.
- On save: for each line → increase item stock AND recompute item avgCost (weighted average) AND
  write a StockMovement of type `purchase` — all inside one transaction per purchase.
- **Supplier** (optional): create/list/edit, name, phone, openingBalance, isActive. Attaching a
  supplier is optional on any purchase.
- **Supplier payables:** a credit purchase increases what the owner owes that supplier; a
  recorded **payment** to the supplier decreases it. Show current balance per supplier.
- **Purchase list/history:** view past purchases, filter by supplier and/or date range; view a
  single purchase's lines.
- avgCost becomes a real, moving number (was default 0 from spec 001).

**Out of scope (explicitly not now):**
- Sales, COGS-on-sale, customer side, profit reports (Phase 3+).
- Purchase returns / supplier refunds (note as a known gap; likely a small follow-up spec).
- Editing/deleting a posted purchase (see §6 — decide; default: no edit, reverse via a
  correcting entry, to protect avgCost history). Confirm in review.
- Per-supplier price history, reorder suggestions, PO workflow/approvals.
- Multi-currency. PKR only.

## 4. UI / flow
- **Purchases page:** list of past purchases (date, supplier-or-"—", total, paid/credit badge),
  filters (supplier, date range), "New purchase" button.
- **New purchase form:**
  - Date (defaults today), optional Supplier picker (searchable; "+ new supplier" inline),
    payment type toggle (Cash default | Credit).
  - Line items: add rows → pick item (search by name/SKU), enter quantity (decimal, in the
    item's base unit), enter unit cost paid (rupees). Line total + grand total auto-calculated.
  - Save → confirmation showing what stock/cost will change is nice-to-have; at minimum a clear
    success state.
- **Supplier view:** list with current balance owed; supplier detail shows purchase history +
  payments + running balance; "Record payment" action.
- **Unhappy paths:** quantity ≤ 0 rejected; unit cost < 0 rejected; empty purchase (no lines)
  rejected; credit purchase with no supplier → require a supplier (you can't owe "nobody").

## 5. Data model changes
- **Supplier** (new) — name (required), phone (optional), openingBalance (Decimal128, default
  0), balance (Decimal128, what the owner currently owes — cached, updated in txn), isActive,
  timestamps.
- **Purchase** (new) — date, supplierId (ref Supplier, **optional**), paymentType (enum:
  cash|credit), lines: [{ itemId, qty (Decimal128), unitCost (Decimal128, paisa or rupees —
  see §6), lineTotal (Decimal128) }], total (Decimal128), note (optional), createdBy (ref
  User, required), timestamps.
- **SupplierPayment** (new) — supplierId (required), amount (Decimal128), date, note, createdBy,
  timestamps. (Payments the owner makes to a supplier to reduce what's owed.)
- **StockMovement** — reuse existing; purchases write type `purchase` with costAtTime = the
  unit cost paid, refId = purchase id, createdBy.
- **Item** — avgCost (already Decimal128 from spec 001) now actually changes on purchase.

No change to Counter/Settings/Category.

## 6. Business rules (be precise — this is where bugs live)
- **Weighted-average cost — the core formula.** On each purchase line for an item:
  ```
  newQty      = oldQty + purchasedQty
  newAvgCost  = ((oldQty * oldAvgCost) + (purchasedQty * unitCost)) / newQty
  ```
  All in Decimal128. Guard the edge cases:
  - If oldQty is 0 (or negative — possible since stock can go negative): newAvgCost = unitCost
    (don't divide weirdly; the new stock simply takes the purchase cost). Decide the
    negative-oldQty handling explicitly in review — recommend: treat oldQty floored at 0 for
    the average so a negative stock doesn't corrupt cost, but still add the purchased qty.
  - newAvgCost is NOT rounded to whole paisa — keep full Decimal128 precision (rounding every
    purchase is the COGS-drift failure mode PROJECT_PLAN §4.1 warns about).
- **One transaction per purchase.** All lines' stock increments + avgCost updates + the
  StockMovement writes + the supplier-balance update (if credit) happen in a single
  `session.withTransaction`. Either the whole purchase posts or none of it does. (A purchase
  with bad data must not leave half the items updated.)
- **Money unit:** prices in spec 001 are integer paisa; costs here are finer (avgCost is
  Decimal128). Decide and state ONE rule: unitCost entered in rupees, stored as Decimal128
  paisa (recommend — keeps it consistent with avgCost being Decimal128 paisa). Confirm in
  review. Reject >2 decimal places in the rupee input, same as import.
- **Supplier optional, except:** paymentType=credit REQUIRES a supplier (can't owe nobody).
  paymentType=cash → supplier optional.
- **Payables:** credit purchase → supplier.balance += purchase.total (in same txn).
  SupplierPayment → supplier.balance -= amount (in its own txn). Balance may not go below the
  supplier's real position — but allow it to (over-payment/advance) and surface, rather than
  block; decide in review.
- **Quantities** in the item's base unit; Decimal128; must be > 0 per line. Reject invalid
  decimals (never coerce), same rule as everywhere.
- **No edit of a posted purchase (recommended).** Because avgCost is path-dependent (it depends
  on the order of purchases), editing a past purchase can't cleanly recompute history. Default:
  posted purchases are immutable; mistakes are fixed with a reversing/correcting entry. Confirm
  — this is a hard-to-change decision.
- **createdBy required** on Purchase, SupplierPayment, and the purchase StockMovements (audit).

## 7. Validation rules
- Purchase: ≥ 1 line; date valid; paymentType in {cash, credit}; if credit, supplierId required.
- Line: itemId references an existing active item; qty Decimal128 > 0; unitCost ≥ 0 (rupees,
  ≤ 2 dp).
- Supplier: name required, 1–120 chars; phone optional; openingBalance ≥ 0.
- SupplierPayment: supplierId required; amount Decimal128 > 0.
- Same Zod-shared-shape approach as prior specs.

## 8. Acceptance criteria (checklist)
- [ ] Can record a cash purchase with multiple lines; stock increases for each item; no supplier
      required.
- [ ] avgCost updates by the exact weighted-average formula — verified with a worked example
      (e.g. 100 @ 110 then 50 @ 120 → avg = 113.333…, full precision, not rounded).
- [ ] oldQty = 0 case: first purchase sets avgCost = unitCost.
- [ ] Each purchase line writes a StockMovement type `purchase` with costAtTime + createdBy.
- [ ] Whole purchase is one transaction: force a mid-purchase failure → nothing persists (no
      partial stock/avgCost updates, no orphan movements).
- [ ] Credit purchase requires a supplier and increases that supplier's balance owed.
- [ ] Recording a supplier payment decreases the balance owed.
- [ ] Supplier list shows correct current balances; supplier detail shows purchases + payments +
      running balance.
- [ ] Purchase list/history filterable by supplier and date range.
- [ ] Invalid inputs (no lines, qty ≤ 0, negative cost, credit without supplier, >2dp cost)
      rejected with clear messages.
- [ ] Works fully through the UI with no AI.
- [ ] Tests cover: the weighted-average math (incl. oldQty 0 and negative-oldQty edge), the
      single-transaction atomicity of a multi-line purchase, supplier balance on credit + on
      payment, and validation.

## 9. Open questions for the owner / review
1. **Negative-oldQty avgCost handling** (§6) — floor oldQty at 0 for the average (recommend), or
   another rule? This only matters once sales can drive stock negative (Phase 3), but the
   formula is set here.
2. **Posted purchases immutable** (§6) — confirm no-edit + reverse-via-correcting-entry, given
   avgCost is path-dependent. (Recommend yes; it's a one-way decision.)
3. **unitCost storage** — rupees-in → Decimal128 paisa stored (recommend, consistent with
   avgCost). Confirm.
4. **Purchase returns** — out of scope for now, handle as a later spec? Or needed at launch?
5. **Supplier balance below zero** (advance/overpayment) — allow and surface, or block? (Recommend
   allow + surface.)
6. **Do you want a running "total stock value" figure** (sum of qty × avgCost) shown anywhere
   now, or defer to the reports phase? (It's nearly free once avgCost is live.)

## 10. Notes / decisions
- The whole point of Phase 2 is correct cost data; Phase 3 (sales) reads avgCost for COGS with
  no rework. Do not compute any profit here.
- Reuse the per-operation transaction pattern and Decimal128 money/qty handling from specs
  001/002 — do not invent a second cost-math path.
- Record the hard-to-change decisions (immutable purchases, unitCost storage, negative-oldQty
  rule) in DECISIONS.md.