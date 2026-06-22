# Spec: 004 — Sales / POS core (+ customers / khata)

- **Status:** in-progress (review complete; building models + sale service + tests first)
- **Phase:** Phase 3 — Sales / POS
- **Author / date:** owner + Claude / 2026-06-22
- **Builds on:** specs 001 (Item retail/wholesale price, `allowNegativeInventory` setting,
  StockMovement with `sale` already in the enum, the deferred "Negative Stock" view), 003
  (avgCost engine, costAtTime, per-operation transactions, Supplier/payables pattern to mirror
  for Customers), 003b (replay-from-movements correctness; the replay engine treats every
  non-purchase movement — including `sale` — as qty-only and never recomputes avg). See ADR-007.

## 1. Problem / goal
Record sales at the counter — the daily heart of the shop — and in doing so, make **profit
real** for the first time. Each sale line captures the actual price sold (after bargaining) AND
the item's avgCost at that moment (COGS), so line profit = price − avgCost. Support cash and
credit (udhaar), per-customer khata ledgers, per-line price overrides, retail/wholesale
selection, a quiet below-cost warning, and selling through low/negative stock without blocking
the cashier.

Receipts are explicitly deferred — record the sale completely now so a receipt (print/screen/
WhatsApp) can be generated later from stored data with no backfill.

## 2. What "profit becomes real" means (the core)
- On each sale line: store `unitPrice` (actual sold price, post-bargain), `qty`, and
  `costAtTime` = the item's **current avgCost at the moment of sale** (snapshotted, never
  recomputed). Line COGS = qty × costAtTime. Line profit = (unitPrice − costAtTime) × qty.
- This is read-only consumption of avgCost — a sale does NOT change avgCost (selling doesn't
  change what your remaining stock cost). It only decreases stockQty and snapshots cost for
  profit. This mirrors the "return removes at current avg, avg unchanged" rule from 003b.
- Because costAtTime is snapshotted per line, profit reporting later is just summing stored
  numbers — no recompute, no drift.
- **Verified (ADR-007):** the 003b replay/recalculate-cost engine already treats `sale`
  movements as qty-only (the branch is `type === "purchase"` vs everything-else), so sales never
  perturb avgCost in replay. Zero engine change; a regression test locks it in.

## 3. User stories
- As the cashier/owner, I want to ring up a sale fast: add items, set qty, accept or override
  the price, take cash — done, without naming a customer.
- As the owner, I want to sell on credit (udhaar) to a known customer, so it's added to their
  khata and I can see what they owe.
- As the owner, I want to bargain — change the price on any line — and still have honest profit
  numbers, with a quiet warning if a line drops below cost.
- As the owner, I want to pick wholesale or retail pricing per sale (dealer vs walk-in), with
  the line price pre-filled and still overridable.
- As the owner, I want to sell even when stock shows 0/low (count was off) without being
  blocked, and have negative stock surfaced to me afterward.
- As the owner, I want to record a customer payment against their khata, so their balance drops.
- As the owner, I want to see a customer's running balance and history.
- (Customer returns/refunds — frequent — deferred to 004b; see §4.)

## 4. Scope
**In scope:**
- **Sale** entry (the POS screen): date, optional customer, paymentType (cash | credit),
  price mode (retail | wholesale) default, one or more lines (item, qty, unitPrice editable,
  server-snapshotted suggestedPrice + costAtTime, line total), grand total, optional note.
  **No sale-level discount** — bargaining is per-line via `unitPrice` (ADR-007 / §9 Q3).
- On save, in ONE transaction per sale, for each line: decrease item stockQty, write a
  StockMovement type `sale` (negative qty, costAtTime = avgCost snapshot, refId = sale,
  createdBy); if credit, increase customer.balance (owed to shop).
- **Customer** (new, mirrors Supplier): name, phone, openingBalance, balance (cached),
  isActive. Optional on cash sales; **required** on credit sales.
- **Customer payments** (mirrors SupplierPayment): record a payment received → customer.balance
  decreases (may go negative = customer advance/credit — allow + surface; in customer wording a
  negative balance means **the shop owes them**).
- **Price behavior:** line price pre-fills from item retail or wholesale per the sale's price
  mode; fully overridable per line (bargaining). The server snapshots `suggestedPrice`
  (= `wholesalePrice ?? retailPrice` in wholesale mode, else `retailPrice`) and stores the
  actual `unitPrice` for honest discount reporting. `suggestedPrice` is derived server-side, not
  trusted from the client.
- **Below-cost signal:** if a line's unitPrice < its costAtTime, show a quiet inline
  "below cost − losing ₹X" indicator. **Derived** (no stored flag). Never blocks. Allowed.
- **Sell through negative stock:** governed by `Settings.allowNegativeInventory` (default true,
  read in-txn via `Settings.getSingleton(session)`). When true, sale completes even if it drives
  stock ≤ 0; never blocks the cashier. When false, a sale that would drive an item negative is
  rejected with a clear message — checked on the **summed** quantity per item across duplicate
  lines.
- **Negative Stock view (owner):** build the spec-001-deferred view here — lists every item with
  stockQty < 0 so the owner can correct counts. This is where negative stock surfaces (Q6).
- **Sale history:** list sales (date, customer-or-"—", total, profit, cash/credit badge),
  filters (customer, date range, cash/credit), view a single sale's lines + per-line profit.
- **Customer view:** list with balances; detail with khata ledger (sales on credit + payments +
  running balance), mirroring SupplierDetail.

**Out of scope (→ sub-spec 004b, built right after core, like 003b followed 003):**
- **Customer returns/refunds AND sale void/cancel** — one coherent reversal model: put stock
  back, refund cash or credit khata, AND reverse the recorded profit. **Confirmed deferred to
  004b** (ADR-007 / §9 Q1). NOTE for 004b: a sale return/void only **restores stock** (a qty-only
  reversing movement) — it must NOT reuse the purchase-reversal cost-exclusion replay, because a
  sale never changed avgCost.
- Receipts (print/screen/WhatsApp) — deferred entirely; data captured now to enable later.
- Profit/sales reports & analytics dashboards — Phase 6. Core stores the data.
- Barcode scanning, multi-cashier sessions, tax/GST.

## 5. Data model changes
- **Customer** (new) — name (required, 1–120), phone (optional), openingBalance (Decimal128,
  default 0, ≥ 0), balance (Decimal128, owed to shop; cached, updated in-txn, **no min** → may go
  negative = advance), isActive, timestamps. **Copy-adapt of `Supplier`.**
- **Sale** (new, **immutable** like Purchase) — date, customerId (ref Customer, optional),
  paymentType (enum: cash|credit), priceMode (enum: retail|wholesale), lines: [{ itemId,
  qty (Decimal128 > 0), unitPrice (Decimal128 paisa, sold price), suggestedPrice (Decimal128
  paisa, server-derived pre-bargain price), costAtTime (Decimal128, avgCost snapshot), lineTotal
  (Decimal128 full precision) }], total (Decimal128, whole paisa = Σ lineTotal rounded), note,
  createdBy (required), timestamps. **No `discount` field** (per-line only — ADR-007).
- **CustomerPayment** (new) — customerId (required), amount (Decimal128 > 0), date, note,
  createdBy, timestamps. **Copy-adapt of `SupplierPayment`.**
- **StockMovement** — **no change**: `sale` is already in the enum (since spec 001). A `sale`
  movement carries costAtTime (snapshot, **audit symmetry only**) + refId (sale) + createdBy, and
  is qty-only in replay (never triggers an avgCost recompute).
- **Settings** — reuse `allowNegativeInventory` + `getSingleton(session)` (already exist).
- **Item** — no schema change; avgCost is read for the snapshot, not written.
- **Two costAtTime copies:** the **Sale line is the source of truth** for profit; the
  `sale` StockMovement's costAtTime is audit symmetry only — NOT a reconciliation target.

## 6. Business rules (precise — this is where bugs live)
- **Money:** unitPrice entered in rupees → Decimal128 paisa via the SHARED money validator
  (reuse, don't fork). Reject >2dp. Line totals full precision; sale `total` rounded to whole
  paisa (HALF_EVEN). avgCost snapshot keeps full scale.
- **costAtTime snapshot:** read `item.avgCost` INSIDE the sale transaction and store it on the
  line. Once stored it never changes — even if avgCost moves later, this sale's profit is locked.
- **suggestedPrice (server-derived):** in-txn, `suggestedPrice = priceMode === "wholesale"
  ? (item.wholesalePrice ?? item.retailPrice) : item.retailPrice`. Never suggest 0 in wholesale
  mode when wholesale is unset — fall back to retail.
- **Stock:** decrease stockQty by qty in the same transaction as the movement write. May go
  negative iff `allowNegativeInventory` (default true → never blocks). If false, a sale that
  would drive an item's **summed** quantity negative is rejected with a clear, named message.
- **One transaction per sale:** all line stock decrements + movements + (credit) customer
  balance update succeed or all roll back. Multi-line atomicity, same as purchases.
- **Duplicate item across lines:** allowed; each line snapshots the SAME current avgCost (a sale
  doesn't move avg), so there is **no sequential-dependency subtlety** like purchases had — lines
  are independent and stock decrements **sum** (one item write per item). No merging needed.
- **Credit requires a customer** (can't owe from "nobody"); cash → customer optional.
- **Credit sale → customer.balance += sale.total** (in txn). CustomerPayment → balance −=
  amount (own txn). Balance may go negative (advance) — allow + surface via `formatBalance`.
- **unitPrice ≥ 0; 0 is allowed** (giveaway/sample) — it simply shows as below-cost (Q2).
- **Below-cost:** derived per line as `unitPrice < costAtTime`; advisory only; nothing stored.
- **Immutable sales:** posted sales are not edited; mistakes handled by 004b (return/void) +
  re-enter.
- **createdBy** on Sale, CustomerPayment, and every `sale` StockMovement.
- **Quantities** in item base unit, Decimal128, > 0 per line (reuse `positiveDecimalString`).
- **Selling an inactive item:** reject (must be active), consistent with purchases. A `customerId`
  supplied on a credit sale must reference an **active** customer.

## 7. Validation rules
- Sale: ≥ 1 line; valid date; paymentType in {cash, credit}; priceMode in {retail, wholesale};
  if credit, customerId required.
- Line: item exists + active; qty Decimal128 > 0; unitPrice rupees ≤2dp, **≥ 0 (0 allowed)**.
  `suggestedPrice`/`costAtTime` are NOT client inputs — server-snapshotted.
- Customer: name required, 1–120; phone optional; openingBalance ≥ 0.
- CustomerPayment: customerId required; amount Decimal128 > 0.
- Shared Zod schemas; reuse money + decimal + qty validators. (No discount validation — dropped.)

## 8. Acceptance criteria (checklist)
- [ ] Can ring a cash sale with multiple lines, no customer; stock decreases per line. *(test-first)*
- [ ] Each sale line stores costAtTime = avgCost at sale moment; line profit = (price − cost) ×
      qty correct; **avgCost itself is UNCHANGED by the sale**. *(test-first)*
- [ ] Price pre-fills from retail/wholesale per price mode (wholesale falls back to retail when
      unset); per-line override works; suggested vs actual stored. *(test-first)*
- [ ] Below-cost line is detectable (unitPrice < costAtTime) and still saves. *(test-first)*
- [ ] Credit sale requires a customer and increases khata balance; customer payment decreases it;
      advance (negative balance) allowed + surfaced. *(test-first)*
- [ ] Selling through 0/low stock completes when allowNegativeInventory true; **rejected when
      false**, checked on summed duplicate-line qty. *(test-first)*
- [ ] One transaction per sale: forced mid-sale failure persists nothing. *(test-first)*
- [ ] Replay/recalculate-cost on an item with `sale` movements still produces correct avgCost
      (sale movements qty-only — regression vs 003b engine). *(test-first)*
- [ ] Inactive item rejected; duplicate-item lines need no merge. *(test-first)*
- [ ] Sale history lists + filters; single-sale view shows per-line profit. *(UI)*
- [ ] Customer list shows balances; customer detail shows khata ledger + payments + running
      balance; Negative Stock view lists stockQty < 0. *(UI)*
- [ ] Works fully through the UI with no AI.

## 9. Decisions (formerly open questions — all resolved in review; see ADR-007)
1. **Sale void:** deferred to **004b** (one coherent void+return reversal model). ✅
2. **unitPrice = 0:** allowed (giveaway/sample; shows below-cost). ✅
3. **Discount:** **per-line only**; `sale.discount` dropped from the model. ✅
4. **suggestedPrice:** captured per line, **server-derived** (`wholesalePrice ?? retailPrice`). ✅
5. **Replay with `sale`:** confirmed qty-only, zero engine change (ADR-007). ✅
6. **Negative Stock view:** built in **this** spec. ✅
7. **Credit limit/warning:** deferred; just surface the balance for now. ✅

## 10. Notes / decisions
- This is the payoff phase: avgCost (built in 003) is finally consumed to produce profit.
- **Reuse relentlessly:** Customer copy-adapts Supplier; CustomerPayment copy-adapts
  SupplierPayment; `recordCustomerPayment` mirrors `recordSupplierPayment`; credit-sale
  `balance += total` mirrors credit-purchase; reuse `Settings.getSingleton`, the shared
  money/decimal/qty validators, `runInTransaction`, `formatBalance`, the immutability model. Do
  NOT fork new versions.
- Customer returns + sale void (004b) are the immediate next spec after this core ships.
- Decisions recorded in **ADR-007**: sale immutability; per-line-discount-only; costAtTime
  snapshot (sale-line = source of truth, movement = audit symmetry); void deferred to 004b;
  replay-unchanged-for-sales.

## 11. Build order (tests-first — PAUSE point)
1. **Models (Customer, Sale, CustomerPayment) + sale service + customer service, with ALL tests
   FIRST:** cost snapshot + profit math; avgCost-unchanged-by-sale; price override/below-cost;
   credit balance + payment + advance; negative-stock sell-through AND reject-with-aggregation;
   multi-line atomicity; replay-still-correct-with-`sale`-movements; inactive-item rejected;
   duplicate-line (no merge). **PAUSE and show green before any UI.**
2. Then routes + controllers (sales, customers, customer payments, negative-stock list).
3. Then the POS sale screen.
4. Then customer khata UI + sale history + Negative Stock view.
