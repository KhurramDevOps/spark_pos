# Spec: 004 — Sales / POS core (+ customers / khata)

- **Status:** draft
- **Phase:** Phase 3 — Sales / POS
- **Author / date:** <you> / <fill in>
- **Builds on:** specs 001 (Item retail/wholesale price, allowNegativeInventory setting,
  StockMovement, the deferred "Negative Stock" view), 003 (avgCost engine, costAtTime,
  per-operation transactions, Supplier/payables pattern to mirror for Customers), 003b
  (replay-from-movements correctness, exclude-don't-subtract for reversals — the same idea
  powers sale voids/returns).

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
- (Customer returns/refunds — frequent — see §4 scope note; likely sub-spec 004b.)

## 4. Scope
**In scope:**
- **Sale** entry (the POS screen): date, optional customer, paymentType (cash | credit),
  price mode (retail | wholesale) default, one or more lines (item, qty, unitPrice editable,
  costAtTime snapshot, line total), grand total, optional overall discount, optional note.
- On save, in ONE transaction per sale, for each line: decrease item stockQty, write a
  StockMovement type `sale` (negative qty, costAtTime = avgCost snapshot, refId = sale,
  createdBy); if credit, increase customer.balance (owed to shop).
- **Customer** (new, mirrors Supplier): name, phone, openingBalance, balance (cached),
  isActive. Optional on cash sales; **required** on credit sales.
- **Customer payments** (mirrors SupplierPayment): record a payment received → customer.balance
  decreases (may go negative = customer advance/credit — allow + surface).
- **Price behavior:** line price pre-fills from item retail or wholesale per the sale's price
  mode; fully overridable per line (bargaining). Store the actual price + the implied discount
  vs the suggested price for honest reporting.
- **Below-cost signal:** if a line's unitPrice < its costAtTime, show a quiet inline
  "below cost − losing ₹X" indicator. Never blocks. Allowed (clearing dead stock is his call).
- **Sell through negative stock:** governed by Settings.allowNegativeInventory (default true
  from spec 001). When true, sale completes even if it drives stock ≤ 0; never blocks the
  cashier; no scary error. Stock may go negative.
- **Negative Stock view (owner):** finally build the spec-001-deferred view — lists every item
  with stockQty < 0 so the owner can correct counts. This is where negative stock surfaces.
- **Sale history:** list sales (date, customer-or-"—", total, profit, cash/credit badge),
  filters (customer, date range, cash/credit), view a single sale's lines + per-line profit.
- **Customer view:** list with balances; detail with khata ledger (sales on credit + payments +
  running balance), mirroring SupplierDetail.

**Out of scope (explicitly → likely sub-spec 004b, build right after core like 003b was):**
- **Customer returns/refunds** (frequent, confirmed needed) — putting stock back, refunding
  cash or crediting khata, AND reversing the recorded profit. Deferred to 004b to keep the core
  sell flow shippable first; it's the immediate next spec, not "someday."
- Receipts (print/screen/WhatsApp) — deferred entirely; data captured now to enable later.
- Sale void/cancel of a posted sale — decide in review whether minimal void belongs in core or
  goes with 004b returns.
- Profit/sales reports & analytics dashboards — Phase 6. Core stores the data; reports come
  later.
- Barcode scanning, multi-cashier sessions, tax/GST.

## 5. Data model changes
- **Customer** (new) — name (required), phone (optional), openingBalance (Decimal128, default
  0), balance (Decimal128, owed to shop; cached, updated in-txn), isActive, timestamps.
  (Mirror Supplier exactly where possible — reuse patterns/validators.)
- **Sale** (new) — date, customerId (ref Customer, optional), paymentType (enum: cash|credit),
  priceMode (enum: retail|wholesale), lines: [{ itemId, qty (Decimal128), unitPrice (Decimal128
  paisa, the sold price), suggestedPrice (Decimal128 paisa, the pre-bargain price for discount
  reporting), costAtTime (Decimal128, avgCost snapshot), lineTotal (Decimal128) }], discount
  (Decimal128 paisa, optional overall), total (Decimal128, whole paisa), note, createdBy
  (required), timestamps. **Immutable**, like Purchase (corrections via 004b return/void +
  re-enter).
- **CustomerPayment** (new) — customerId (required), amount (Decimal128), date, note, createdBy,
  timestamps.
- **StockMovement** — add `sale` to the type enum (negative qty); carries costAtTime (the
  snapshot) + refId (sale) + createdBy. NOTE: a `sale` movement does NOT trigger an avgCost
  recompute in replay — it only moves running qty (this is exactly the rule 003b's replay was
  built to honor; confirm replay already treats non-purchase movements as qty-only — it does).
- **Settings** — reuse allowNegativeInventory (already exists).
- **Item** — no schema change; avgCost is read for the snapshot, not written.

## 6. Business rules (precise — this is where bugs live)
- **Money:** unitPrice/suggestedPrice entered in rupees → Decimal128 paisa via the SHARED money
  validator (the one unified across import + purchases — reuse, don't fork). Reject >2dp. Line
  totals full precision; sale `total` (and any cash tendered/change later) rounded to whole
  paisa. avgCost snapshot keeps full scale.
- **costAtTime snapshot:** read item.avgCost INSIDE the sale transaction (like purchases read
  state in-txn) and store it on the line. Once stored it never changes — even if avgCost moves
  later, this sale's profit is locked to what it actually cost then.
- **Stock:** decrease stockQty by qty in the same transaction as the movement write. May go
  negative iff Settings.allowNegativeInventory; if that ever gets set false, then a sale that
  would go negative is rejected with a clear message (but default is true → never blocks).
- **One transaction per sale:** all line stock decrements + movements + (credit) customer
  balance update succeed or all roll back. Multi-line atomicity, same as purchases.
- **Duplicate item across lines:** allowed; each line is independent (sale doesn't recompute
  avg, so no sequential-dependency subtlety like purchases had) — but stock decrements sum.
  Confirm we don't need to merge.
- **Credit requires a customer** (can't owe from "nobody"); cash → customer optional.
- **Credit sale → customer.balance += sale.total** (in txn). CustomerPayment → balance −=
  amount (own txn). Balance may go negative (advance) — allow + surface via the formatBalance
  helper already built.
- **Below-cost:** computed per line as unitPrice < costAtTime; advisory only; recorded so
  reports can show loss-making sales.
- **Immutable sales:** posted sales are not edited; mistakes handled by 004b (return/void) +
  re-enter. State plainly (avoids the editing-corrupts-history problem).
- **createdBy** on Sale, CustomerPayment, and every sale StockMovement.
- **Quantities** in item base unit, Decimal128, > 0 per line (reuse positiveDecimalString).
- **Selling an inactive item:** reject (must be active), consistent with purchases.

## 7. Validation rules
- Sale: ≥ 1 line; valid date; paymentType in {cash, credit}; priceMode in {retail, wholesale};
  if credit, customerId required.
- Line: item exists + active; qty Decimal128 > 0; unitPrice ≥ 0 (rupees, ≤2dp) — allow 0?
  (free/giveaway — decide; recommend allow + it'll show as below-cost).
- Discount (if used): ≥ 0, not exceeding the lines subtotal — decide handling if it would make
  total negative (recommend cap/reject).
- Customer: name required; phone optional; openingBalance ≥ 0.
- CustomerPayment: customerId required; amount Decimal128 > 0.
- Shared Zod schemas; reuse money + decimal validators.

## 8. Acceptance criteria (checklist)
- [ ] Can ring a cash sale with multiple lines, no customer; stock decreases per line.
- [ ] Each sale line stores costAtTime = avgCost at sale moment; line profit = (price − cost)
      × qty computed correctly; avgCost itself is UNCHANGED by the sale.
- [ ] Price pre-fills from retail/wholesale per price mode; per-line override works; the
      suggested vs actual is stored for discount reporting.
- [ ] Below-cost line shows the quiet warning and still saves.
- [ ] Credit sale requires a customer and increases their khata balance; recording a customer
      payment decreases it; advance (negative balance) allowed + surfaced.
- [ ] Selling through 0/low stock completes without blocking (allowNegativeInventory true) and
      the item appears in the Negative Stock view when it goes below 0.
- [ ] One transaction per sale: forced mid-sale failure persists nothing (no partial stock
      decrements, no orphan movements, no half-applied balance).
- [ ] Sale history lists + filters; single-sale view shows per-line profit.
- [ ] Customer list shows balances; customer detail shows khata ledger + payments + running
      balance.
- [ ] Replay/recalculate-cost on an item with sale movements still produces correct avgCost
      (i.e. sale movements are qty-only in replay — regression check against 003b engine).
- [ ] Works fully through the UI with no AI.
- [ ] Tests cover: cost snapshot + profit math, avgCost-unchanged-by-sale, price
      override/below-cost, credit balance + payment, negative-stock sell-through, multi-line
      atomicity, replay-still-correct-with-sale-movements.

## 9. Open questions for the owner / review
1. **Sale void in core, or only in 004b?** A simple "this sale never happened" void (reverse
   stock + khata, like a full reversal) — include minimally now, or bundle with customer returns
   in 004b? (Lean: bundle in 004b for one coherent reversal model.)
2. **unitPrice = 0 allowed** (giveaway/sample)? Recommend yes; shows as below-cost.
3. **Overall discount** — keep the per-line override AND a sale-level discount, or per-line
   only? (Per-line is more honest for profit attribution; sale-level discount complicates
   per-line profit. Recommend per-line only for v1, revisit.)
4. **suggestedPrice capture** — store the pre-bargain price per line for discount analytics?
   (Recommend yes — cheap now, valuable in reports.)
5. **Replay confirmation** — confirm the 003b replay engine already treats any non-purchase
   movement (now including `sale`) as qty-only and never recomputes avg from it. (Believed yes;
   verify before relying on it.)
6. **Negative-stock surfacing** — the deferred Negative Stock view: build it in this spec
   (recommended, since sales are what create negative stock) or as a tiny separate one?
7. **Customer required threshold for credit** — any credit limit / warning when a customer's
   khata gets large? (Probably later; flag.)

## 10. Notes / decisions
- This is the payoff phase: avgCost (built in 003) is finally consumed to produce profit.
- Reuse relentlessly: Customer mirrors Supplier; CustomerPayment mirrors SupplierPayment;
  formatBalance, shared money/decimal/qty validators, the per-operation transaction pattern,
  the immutability+reversal model — all already exist. Do NOT fork new versions.
- Customer returns (004b) are the immediate next spec after this core ships — confirmed frequent.
- Record decisions (sale immutability, per-line vs sale discount, void-now-vs-004b, costAtTime
  snapshot rule) in DECISIONS.md.
- Build order proposal: models (Customer/Sale/CustomerPayment) + the sale service with
  cost-snapshot/profit/atomicity/negative-stock tests FIRST (prove the money + stock + replay
  interactions before UI), PAUSE for review, then routes, then the POS sale screen, then
  customer khata UI + Negative Stock view.