# Spec: 003 — Purchases & weighted-average cost

- **Status:** in-progress (decisions confirmed by owner 2026-06-22; building math + cost service)
- **Phase:** Phase 2 — Purchases & cost
- **Author / date:** owner / 2026-06-22
- **Builds on:** spec 001 (Item.avgCost as Decimal128; StockMovement with `purchase` type
  already in the enum; costAtTime as Decimal128; rs0 transactions; per-operation transaction
  rule). Reuses the rupee→paisa money parsing from spec 002 (lifted into a shared validator).
- **Decisions recorded in:** `docs/DECISIONS.md` ADR-005 (division scale + rounding; immutable
  purchases + reversal can't restore avgCost; paisa rules; oldQty flooring; posting-order).
- **Follow-up:** **spec 003b — purchase returns / reversals**, built immediately after this
  (immutability needs it; see §6). Do not put purchases into real daily use relying on DB
  restore as the only fix for a mistyped purchase.

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
- **Supplier** (new) — name (required, 1–120), phone (optional), openingBalance (Decimal128,
  default 0, ≥ 0), balance (Decimal128, what the owner currently owes — cached, updated in txn;
  **set = openingBalance on create**, then runs; **may go negative** = advance), isActive,
  timestamps.
- **Purchase** (new, **immutable once posted**) — date, supplierId (ref Supplier, **optional**),
  paymentType (enum: cash|credit), lines: [{ itemId, qty (Decimal128), unitCost (Decimal128
  **paisa**), lineTotal (Decimal128 paisa, full precision) }], total (Decimal128 **whole
  paisa** — the payable), note (optional), createdBy (ref User, required), timestamps. Stored
  totals are a historical snapshot (never recomputed — consistent with immutability), computed
  server-side.
- **SupplierPayment** (new) — supplierId (required), amount (Decimal128), date, note, createdBy,
  timestamps. (Payments the owner makes to a supplier to reduce what's owed.)
- **StockMovement** — reuse existing; purchases write type `purchase` with costAtTime = the
  unit cost paid, refId = purchase id, createdBy.
- **Item** — avgCost (already Decimal128 from spec 001) now actually changes on purchase.

No change to Counter/Settings/Category.

## 6. Business rules (be precise — this is where bugs live)

- **Weighted-average cost — the core formula (per line, in paisa).**
  ```
  effectiveOld   = max(oldQty, 0)        // floor negative stock to 0 for the average
  newAvgCost     = (effectiveOld·oldAvgCost + purchasedQty·unitCost)
                   / (effectiveOld + purchasedQty)
  stockQty(new)  = oldQty + purchasedQty // REAL arithmetic — may stay negative or hit 0
  ```
  Note the **two different "new quantities"**: the average's denominator is
  `effectiveOld + purchasedQty` (always `> 0`, since `purchasedQty > 0`), while the item's new
  `stockQty` uses the real `oldQty + purchasedQty`. They are not the same value and must not be
  conflated. Flooring `oldQty` at 0 in **both** numerator and denominator (a) stops negative
  stock from corrupting cost and (b) **eliminates divide-by-zero** (e.g. `oldQty = -50`, buy
  `50` → real `stockQty = 0`, but the average divides by `50`, giving `avg = unitCost`).
  - `oldQty = 0` → `avg = unitCost` (falls out of the formula; first purchase sets the cost).
  - `oldQty < 0` → `avg = unitCost` (effectiveOld = 0).
- **avgCost precision: fixed scale 10, round-half-even.** Division can't be exact
  (`17000/150 = 113.333…`), so avgCost is kept to **10 fractional digits of paisa** with
  **round-half-even** (banker's). This is NOT whole-paisa rounding — rounding cost to whole paisa
  every purchase is the COGS-drift failure mode PROJECT_PLAN §4.1 warns about. (Worked example:
  100 @ 11000p then 50 @ 12000p → `11333.3333333333` paisa.)
- **Money is computed with exact BigInt arithmetic** in `lib/decimal.js` (`add`, `multiply`
  exact; `divide(a, b, scale, rounding)`). No floats. Do not add a decimal library.
- **One transaction per purchase.** All lines' stock increments + avgCost updates + the
  StockMovement writes + the supplier-balance update (if credit) happen in a single
  `session.withTransaction`. Either the whole purchase posts or none of it does.
- **Read item state INSIDE the transaction** (oldQty/oldAvg), like `adjustStock` does. Concurrent
  purchases of the same item resolve via Mongo's write-conflict retry in `withTransaction`.
  Computing avgCost from a pre-txn read would corrupt under concurrency.
- **Lines are processed sequentially; duplicate item across lines builds on the running value.**
  Two lines for the same `itemId` in one purchase apply in order — line 2's avgCost uses the
  running stock/avg after line 1, not the original snapshot. (Implementation: keep the item doc
  in memory across the lines within the txn; save once.)
- **Money unit:** unitCost entered in **rupees**, stored as **Decimal128 paisa** (consistent with
  avgCost). Reject > 2 decimal places in the rupee input. `unitCost = 0` is allowed (free
  samples) — it will legitimately pull avgCost down. The rupee→paisa + >2dp logic is the **shared
  money validator** lifted from spec 002 — do not duplicate it.
- **Totals/payables round to WHOLE paisa; avgCost keeps full scale (two separate rules).**
  `lineTotal = purchasedQty·unitCost` can be fractional paisa (fractional qty); the **purchase
  `total` (the payable) is rounded to whole paisa** — you can't owe a fraction of a paisa.
  avgCost is unaffected (it uses qty·unitCost directly, never the rounded total). Totals are
  **computed server-side; a client-sent total is ignored.**
- **Supplier optional, except:** paymentType=credit REQUIRES a supplier (can't owe nobody);
  paymentType=cash → supplier optional.
- **Payables:** credit purchase → `supplier.balance += total` (same txn). SupplierPayment →
  `supplier.balance -= amount` (its own txn — two collections). `balance = openingBalance` on
  supplier create, then runs. **Balance may go negative** (advance/overpayment) — allow and
  surface as "advance / supplier owes you"; never block a payment.
- **Quantities** in the item's base unit; Decimal128; **must be > 0** per line (use the new
  `positiveDecimalString` validator). Reject invalid decimals (never coerce).
- **Active item required.** A line's `itemId` must reference an **active** item; restocking a
  deactivated item means reactivating it first (clear message otherwise).
- **Backdating does NOT reorder cost history.** `date` is a label; avgCost is applied in
  **posting order**, not date order. A backdated purchase still updates avgCost as-of-now.
- **No edit of a posted purchase — immutable (one-way decision).** avgCost is path-dependent, so
  editing a past purchase can't cleanly recompute history. Mistakes are fixed by a
  reversing/correcting entry (**spec 003b**, built next). Important caveat: a reversal can fix
  **stock and payables exactly, but cannot losslessly restore avgCost** (you can't un-average a
  weighted average). The true repair path is **replay-from-`costAtTime`** — which is why every
  purchase StockMovement stores `costAtTime` (the unit cost paid). Until 003b ships, a backup
  (mongodump, see backend/README.md) is the interim safeguard.
- **createdBy required** on Purchase, SupplierPayment, and the purchase StockMovements (audit).

## 7. Validation rules
- Purchase: ≥ 1 line; date valid; paymentType in {cash, credit}; if credit, supplierId required.
- Line: itemId references an existing **active** item; qty Decimal128 **> 0** (new
  `positiveDecimalString`); unitCost ≥ 0 (rupees, **≤ 2 dp** via the shared money validator;
  0 allowed).
- Supplier: name required, 1–120 chars; phone optional; openingBalance ≥ 0.
- SupplierPayment: supplierId required; amount Decimal128 > 0.
- Same Zod-shared-shape approach as prior specs. **New shared pieces:** `positiveDecimalString`
  (>0) in `shared/validation/common.js`, and the **rupee-money validator** (≤2dp, ≥0) lifted
  from spec 002's import path so import and purchases share one rupee→paisa rule.

## 8. Acceptance criteria (checklist)
- [ ] Can record a cash purchase with multiple lines; stock increases for each item; no supplier
      required.
- [ ] avgCost updates by the weighted-average formula at scale 10, round-half-even — verified
      with the worked example (100 @ 11000p then 50 @ 12000p → `11333.3333333333` paisa).
- [ ] oldQty = 0 case: first purchase sets avgCost = unitCost.
- [ ] negative-oldQty floors to 0 (avg = unitCost); the `oldQty = -50, buy 50` case (real
      stockQty → 0) does NOT divide by zero.
- [ ] duplicate item across two lines in one purchase: line 2 builds on line 1's running avg.
- [ ] purchase total is whole paisa (payable); avgCost keeps full scale; client-sent total ignored.
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

## 9. Decisions from the owner (answered 2026-06-22)
1. **Negative/zero-oldQty → floor at 0 in BOTH numerator and denominator** (§6). Eliminates
   divide-by-zero; negative stock can't corrupt cost. `avg = unitCost` when effectiveOld = 0.
2. **Posted purchases immutable** (§6). Reverse via a correcting entry — **spec 003b, built next**
   (don't rely on DB restore as the only fix). A reversal fixes stock/payables exactly but
   **cannot losslessly restore avgCost**; replay-from-`costAtTime` is the true repair path.
3. **unitCost rupees-in → Decimal128 paisa, reject >2dp** (§6). `unitCost = 0` allowed (samples).
   Rupee→paisa logic **lifted into a shared money validator** (used by import + purchases).
4. **Purchase returns/reversals → spec 003b, immediately after this** (not "someday" — immutability
   needs it).
5. **Supplier balance may go negative** (advance/overpayment) — allow + surface; never block a
   payment.
6. **Total stock value deferred to the reports phase**; when built, **computed live** (Σ qty·avgCost),
   **never cached**.

Also fixed (from review): division **scale 10, round-half-even**; **avgCost full scale vs
totals/payables whole paisa** (two rules); **lines processed sequentially** (duplicate item
builds on running value); **read item state inside the txn**; **active item required**;
**balance = openingBalance on create**; **backdating doesn't reorder cost history** (posting
order governs); add **`positiveDecimalString` (>0)** validator.

## 10. Notes / decisions
- The whole point of Phase 2 is correct cost data; Phase 3 (sales) reads avgCost for COGS with
  no rework. Do not compute any profit here.
- Reuse the per-operation transaction pattern and Decimal128 money/qty handling from specs
  001/002 — do not invent a second cost-math path. The exact arithmetic (`add`/`multiply`/
  `divide`) lives in `lib/decimal.js`.
- Hard-to-change decisions recorded in `docs/DECISIONS.md` **ADR-005**: division scale+rounding,
  immutability + reversal-can't-restore-avgCost, paisa rules (cost full scale / payable whole),
  oldQty flooring, posting-order.

## 11. Build order
0. `lib/decimal.js` arithmetic (`add`, `multiply`, `divide` with scale+half-even) + tests.
1. Models (Supplier, Purchase, SupplierPayment) + the cost service `recordPurchase` with the
   weighted-average / edge / single-transaction-atomicity tests. **← pause; show cost math green.**
2. Routes (purchases, suppliers, payments) + the shared money validator lift.
3. Purchase UI (new-purchase form, purchase history).
4. Suppliers / payments (supplier list + balances, record-payment).