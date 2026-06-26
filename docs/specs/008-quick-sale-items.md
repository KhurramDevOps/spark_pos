# Spec: 008 — Quick Sale items (uncatalogued, cost-unknown checkout lines)

- **Status:** ✅ reviewed / approved (2026-06-27). Four open questions resolved: Q-PERM = workers
  may create quick sales, no toggle (v1); Q-RET = void-only reversal (v1), defer partial quick
  returns; Q-REV-SHAPE = approved as proposed with the Daily-Close figure distinction stated in §9;
  Q-PRICE0 / Q-NAME = yes / yes. ADR-016 committed to DECISIONS.md. Implementation tests-first, in
  slices (§11), pausing on green per workflow.
- **Phase:** Phase 6 polish tier (a correctness-sensitive addition, same discipline as 004b /
  006b / 006c). Must land cleanly before Phase 7 AI, because the AI reasons over the same
  profit numbers this spec must not corrupt.
- **Author / date:** Claude Code (proposed) / 2026-06-27
- **Builds on:** Sale model + recordSale (spec 004), sale void/return (spec 004b), Daily Close
  cash math + gross profit (spec 005 / ADR-010), Reports (spec 006 / ADR-011), and the
  cost-integrity discipline of opening stock (spec 006c / ADR-013). Touches the **shape of a
  sale line and therefore of profit data** → proposes **ADR-016** (§10).

---

## 1. Problem / goal

The shop sells many tiny, high-count, low-value goods — screws, lugs, small connectors, tape —
that are not worth cataloguing as Inventory items (no SKU, no stock count, no purchase history).
Today a worker **cannot ring these up at all** without first creating a full Item. The owner
wants a **"Quick Sale"** line: at checkout, type a **name + price** and add it to the sale,
alongside (or instead of) normal catalogued item lines.

## 2. User stories

- As a worker at the counter, I want to add a "10 × wall screws @ Rs 5" line by typing a name
  and price, without creating an inventory item, so I can complete the sale and take the cash.
- As the owner, I want that cash to show up correctly in the drawer / Daily Close, **but I never
  want it counted as known profit**, because I don't know what those screws cost me.
- As the owner, I want Reports to make the untracked-cost portion **visible and separate**, so my
  margin and profit numbers stay honest.

## 3. Scope

**In scope:**
- A second **kind** of sale line — `"quick"` — carrying `name + unitPrice + qty` only, no
  `itemId`, **no cost basis**, on the same sale as normal `"item"` lines.
- No stock effect for quick lines (there is no Item to decrement).
- Correct cash treatment: quick-sale revenue flows into `Sale.total` → Daily Close cash math and
  Reports revenue, exactly like normal sales (it is real cash).
- **Explicit separation of quick-sale revenue from COGS-based gross profit everywhere it is
  reported** — Daily Close, Reports headline, item performance.
- Void of a sale containing quick lines (reverses cash/khata; skips stock for quick lines).
- Shared Zod validation (frontend + backend), money in paisa, per the golden rules.

**Out of scope (explicitly not now — see Open Questions):**
- Per-line **return** of a quick-sale line (the existing return flow is itemId + stock keyed).
  Proposed v1 reversal path for a quick line is **whole-sale void**. (§9 Q-RET)
- Any cost/margin estimate for quick items. Their profit is **unknown**, full stop — never
  guessed, never defaulted to 0.
- Promoting a quick line into a real Item, or remembering past quick-sale names as suggestions.
- A unified "all money events" ledger (ADR-011 says aggregate on read; not needed here, §6).

## 4. UI / flow

**POS / checkout (frontend cart):**
- Add a **"Quick item"** button next to the item picker. It opens a tiny inline form: **Name**
  (text) and **Unit price** (rupees), with a **Qty** (defaults 1). "Add" pushes a `quick` line
  into the same cart the catalogued items use.
- A quick line renders in the cart with its typed name, a small **"no cost tracked"** tag, and
  the same per-line bargain/price editing as item lines (it's just a price). It has **no stock
  badge** and no below-cost warning (there is no cost).
- Payment (cash/credit), totals, and posting are unchanged — a sale may be all item lines, all
  quick lines, or mixed. A credit (khata) sale including quick lines is allowed; the khata owes
  the full total including quick revenue.

**Sales History:** the "Items" column label (`saleItemsLabel`) uses the quick line's stored
`name` (item lines still resolve via populate). A sale's detail view shows quick lines with a
"Quick sale — cost not tracked" note and no cost/profit column value.

**Daily Close:** unchanged cash math (quick revenue is already inside `cashSales`). The profit
block gains one explicit read-only line: **"Quick sales (cost not tracked): Rs Y (N lines)"**,
shown *next to* gross profit, never added into it. The `cashSales` drill-down lists quick-sale
rows labelled as such.

**Reports:** Revenue tile includes quick sales (real money). Gross-profit and Net tiles
**exclude** quick-sale profit. A caption / small tile surfaces **"Quick-sale revenue (cost
untracked): Rs Y"** so the gap between revenue and profit is explained, not mysterious. In Item
Performance, quick sales appear as a **single synthetic row "Quick sales (uncatalogued)"** with
revenue shown and **profit shown as "—" (not 0)**; they never appear per-item and never enter
dead-stock.

**Unhappy paths:** empty name → validation error; negative price/qty → validation error;
quick line with price 0 allowed (giveaway) — same as item lines today.

## 5. Data model changes

**`Sale.lines[]` becomes polymorphic on a new `kind` discriminator** (backward compatible —
existing lines default to `"item"` and keep every field they have today):

```
saleLineSchema:
  kind:          String, enum ["item","quick"], default "item", required
  qty:           Decimal128, required   (both kinds; > 0)
  unitPrice:     Decimal128, required   (both kinds; paisa, >= 0)
  lineTotal:     Decimal128, required   (both kinds; paisa, qty·unitPrice full precision)

  # kind = "item" ONLY (unchanged from today; conditionally required):
  itemId:        ObjectId ref Item,   required when kind==="item"
  suggestedPrice:Decimal128,          required when kind==="item"
  costAtTime:    Decimal128,          required when kind==="item"   ← COGS basis

  # kind = "quick" ONLY:
  name:          String (1..120, trim), required when kind==="quick"
```

Conditional `required` via `required: function () { return this.kind === "item" }` (and the
mirror for `name`). **Critical invariant: a quick line has NO `costAtTime` field at all** — not
0, not null, *absent*. This is deliberate (ADR-016): it makes "no cost" structurally impossible
to mistake for "cost = 0", and forces every profit-summing loop to branch on `kind` rather than
silently reading a 0.

**No new collection, no StockMovement type, no Item change.** (Rationale in §6 / Q-AUDIT.)

Migration: none. Existing sales have no `kind` and read back as `"item"` via the schema default;
all their fields are already present.

## 6. Business rules (be precise — this is where bugs live)

**Money handling:** quick `unitPrice` arrives in rupees, converted to paisa at the controller
boundary (same single path as item lines, `rupeesToPaisa`). `lineTotal = qty·unitPrice` (full
precision); `Sale.total = round(Σ all lineTotals)` — item **and** quick. Integer paisa / Decimal,
never float (golden rule #2).

**Stock effects:** **none for quick lines.** `recordSale` does not load an Item, does not
decrement stock, does not create a `sale` StockMovement, and does not run the negative-stock gate
for a quick line. Item lines behave exactly as today, in the same one transaction (golden rule
#3). A sale of only quick lines writes the `Sale` (and a credit khata bump) and **zero**
StockMovements.

**COGS / valuation impact — THE load-bearing rule:** quick lines contribute **Rs 0 to gross
profit and are excluded from per-item performance**, because their cost is unknown. Concretely,
the two gross-profit loops —
- `dailyCloseService.aggregateCashFlows` (`Σ (unitPrice − costAtTime)·qty`, lines 50–57), and
- `reportsService.aggregateItemPerformance` (per-item `bump`, line ~109) —

**skip any line where `kind !== "item"`.** They never read `costAtTime` on a quick line (there is
none). Quick revenue still reaches the owner through `Sale.total`:
- `cashSales` / Daily Close cash math: `Σ Sale.total` for cash, voided:false → **includes** quick
  revenue automatically. Drawer reconciliation stays correct with **no change** to the cash math.
- Reports `aggregateRevenue`: `Σ Sale.total − refunds` → **includes** quick revenue.

So: **revenue includes quick sales; profit excludes them.** That asymmetry is real and must be
surfaced (UI §4), never hidden. A new aggregate **`quickSalesRevenue`** (and a count) is computed
alongside the flows for display only — it is *not* added into `grossProfit` or `net`.

This is the precise anti-pattern of the 006c bug: there, a cost=0 opening line diluted avgCost via
weighted-average and overstated profit ~100%. Here we refuse to let an unknown cost masquerade as
0 anywhere a profit number is formed.

**Void:** `voidSale` reverses cash/khata via `sale.total` (already includes quick revenue —
correct) and restores stock **only for item lines** (filter `kind==="item"` before building the
reversal StockMovements and the per-item stock add). A voided mixed sale drops out of both
revenue and profit (the `voided:false` filter), which is correct. Quick lines need no stock
reversal because none was ever decremented.

**Returns:** the existing per-line customer-return flow is keyed by `itemId` + stock. A quick
line has neither. v1: **quick lines are not individually returnable**; reverse via whole-sale
void (reverses cash/khata only for the quick portion). See Q-RET — this is a confirm/decide item.

**Edge cases:** mixed sale void (above); credit sale with quick lines (khata owes full total);
duplicate quick names on one sale (allowed — they're free text, each line independent); quick
line qty fractional? — propose **integer-or-decimal allowed** (same `positiveDecimalString` as
items) but most quick items are counts; not constrained further.

**Audit completeness (Q-AUDIT):** the **immutable `Sale` record is sufficient.** Each quick line
stores `name + qty + unitPrice + lineTotal`; the sale stores `createdBy + date + note` and is
never edited (corrections are void). That fully answers "who sold what quick item, for how much,
when." StockMovement exists to reconstruct **stock + avgCost** by replay — quick lines have
neither, so a StockMovement-equivalent would be an empty ceremony. The cash side is already
captured by Daily Close reading `Sale.total` (aggregate-on-read, ADR-011). **No new ledger.**

## 7. Validation rules (→ shared Zod, frontend + backend)

`shared/validation/sale.js` — make a line a **union** keyed on `kind` (default `"item"` so
existing payloads/tests validate unchanged):

- **item line** (`kind` absent or `"item"`): `itemId` (objectId, required), `qty`
  (positiveDecimalString), `unitPrice` (rupeesString ≥ 0). *(unchanged from today)*
- **quick line** (`kind: "quick"`): `name` (string, trim, 1..120, required), `qty`
  (positiveDecimalString), `unitPrice` (rupeesString ≥ 0). **No `itemId`.**

`suggestedPrice` / `costAtTime` are never client-supplied (server-only for item lines; absent for
quick lines). A sale still needs ≥ 1 line; credit still requires a customer.

## 8. Acceptance criteria (checklist)

- [ ] A sale can be posted with quick lines only, item lines only, or mixed — through the UI, no AI.
- [ ] A quick line writes **no** StockMovement and touches **no** Item.stock (asserted in a test).
- [ ] `Sale.total` and `cashSales` include quick revenue; the drawer math reconciles unchanged.
- [ ] Daily Close `grossProfit` is **identical** to a control sale with the quick line removed —
      i.e. the quick line adds **0** to profit (regression test against the 006c bug shape).
- [ ] Reports gross-profit / net exclude quick-sale profit; Revenue includes quick-sale cash;
      `quickSalesRevenue` is reported separately and equals Σ quick lineTotals (net of voids).
- [ ] Item Performance never shows a quick line as a per-item row, never as cost=0 profit.
- [ ] Voiding a mixed sale reverses cash/khata fully and restores stock for item lines only.
- [ ] Existing 004 / 004b / 005 / 006 / 006c tests stay green untouched (kind defaults to "item").
- [ ] Any write spanning >1 collection stays inside the existing single transaction (rule #3).
- [ ] Shared Zod validates both kinds on frontend and backend; money is paisa/Decimal end to end.

## 9. Open questions for the owner

- **Q-PERM (permissions — please confirm):** May a **worker** create quick-sale lines, same as a
  normal sale? **My recommendation: yes** — this is precisely the worker-at-counter case, and
  every quick line is fully audit-logged (createdBy, immutable sale, name+price visible in History
  and the Daily Close drill-down). The risk to weigh: quick sales bypass catalogued cost/stock, so
  a worker can enter an arbitrary name/price with no inventory trail. If you want a guard, I can
  add a Settings toggle "allow workers to create quick sales" (owner-default on/off your call).
  **Not deciding this silently — your confirm.**
- **Q-RET (returns):** For v1, should reversing a quick line be **whole-sale void only** (simplest,
  reverses cash/khata, no stock — my recommendation), or do you need **partial per-line refunds**
  of a quick line on a mixed sale? The latter needs the CustomerReturn model extended to reference
  a quick line (by name/index, value-only, no stock) — a real but contained addition. How often do
  customers return a screw-type item?
- **Q-REV-SHAPE (reporting display) — APPROVED, with this Daily-Close figure distinction stated
  explicitly (owner's required clarification, do NOT conflate these three):**
  - **"Expected cash in drawer"** (`expectedCash`) is the **cash-based** figure. It already
    includes quick-sale revenue via `cashSales` (= Σ `Sale.total`). **No change needed** — quick
    cash flows into the drawer reconciliation automatically. This is the figure that "includes
    quick-sale revenue via Sale.total."
  - **"Gross profit today"** (`grossProfit`) is the **COGS-based** figure. It **excludes** quick
    sales (their cost is unknown).
  - **"Net for the day"** (`netForDay = grossProfit − expenses`, `dailyCloseService.js:180`,
    rendered at `DailyClose.jsx:214`) is **profit-based, NOT cash-based** — it derives from gross
    profit, so it **also excludes** quick-sale revenue. It must never be conflated with Expected
    cash. On a quick-heavy day, Net for the day reads *lower* than the true economic net, by design,
    because quick-sale profit is unknown — which is precisely why the separate **"Quick-sale revenue
    (cost untracked): Rs Y (N lines)"** figure is mandatory beside Gross profit / Net.
  - Reports: Revenue tile includes quick sales; Gross-profit / Net tiles exclude them; a caption /
    tile surfaces the separate quick-sale revenue; Item Performance shows one synthetic **"Quick
    sales (uncatalogued)"** row with profit **"—" (not 0)**.
- **Q-PRICE0 — APPROVED:** a **Rs 0** quick line (giveaway) is allowed, matching item lines today.
- **Q-NAME — APPROVED:** quick name is free text, 1..120 chars, no dedupe/suggestions in v1.

## 10. Notes / decisions → proposed ADR-016

**Proposed ADR-016 — "Quick Sale" lines: revenue without a cost basis, structurally separated
from COGS profit.** (To be written into `docs/DECISIONS.md` on owner sign-off, like ADR-013 at
006c ship.)

- **Context:** Tiny uncatalogued goods need to be sold without an Item. A sale line therefore must
  be able to carry revenue with **no cost basis**. The danger (the 006c lesson) is an unknown cost
  being silently treated as 0 and inflating profit.
- **Decision:**
  1. A sale line gains a `kind` discriminator (`"item"` default | `"quick"`). A quick line stores
     `name + qty + unitPrice + lineTotal` and **deliberately has no `costAtTime`/`itemId` field at
     all** — absence, not zero.
  2. **Revenue (`Sale.total`, `cashSales` → Daily Close "Expected cash in drawer", Reports
     revenue) includes quick lines** — real cash. The drawer/cash math needs no change because it
     already sums `Sale.total`. The **profit-based** figures — "Gross profit today" and
     "Net for the day" (`grossProfit − expenses`) — **exclude** quick lines; "Net for the day" is
     therefore NOT the cash figure and must not be conflated with Expected cash.
  3. **Every gross-profit computation skips `kind !== "item"` lines.** Quick-sale profit is
     *unknown* and is never formed, never defaulted to 0, never put in a per-item performance row.
  4. Quick-sale revenue is reported as its **own visible figure** so the revenue-vs-profit gap is
     explained, not hidden.
  5. No StockMovement and no new ledger: quick lines have no stock/avgCost to replay, and the
     immutable Sale record is the complete audit trail (consistent with ADR-011 aggregate-on-read).
- **Consequences:** sales become heterogeneous (a small `kind` branch in recordSale, void, and the
  two profit loops); margin on a quick-heavy day reads *low* unless the separate quick-revenue
  figure is read alongside — which is honest, and the reason that figure is mandatory. Per-line
  returns of quick items are deferred (void is the reversal path) pending Q-RET.
- **Alternatives rejected:** (a) storing `costAtTime = 0` on quick lines — this is the 006c bug by
  construction; rejected. (b) A separate `QuickSale` collection — fragments the one-sale-one-record
  model, complicates Daily Close/returns/khata, and buys nothing over a line `kind`. (c) Asking the
  worker to estimate cost — invents numbers the AI would later trust; rejected.

## 11. Build order (slices — tests first, pause on green between each)

The spec has natural seams; build in four slices, each green before the next:

1. **Model + validation (no behavior yet).** Polymorphic `Sale.lines` (`kind` discriminator,
   conditional `required`, quick `name`, no `costAtTime` on quick) + shared Zod line union
   (default `"item"`). Tests: a quick line validates and persists with no cost/itemId; an item
   line (no `kind`) is byte-identical to today; existing sale-model/validation tests green.
2. **recordSale + posting path.** `recordSale` branches per line: quick lines skip Item load,
   stock gate, decrement, and StockMovement; `total` includes quick lineTotals; controller maps
   the quick line (name, qty, rupees→paisa) at the boundary. Tests: quick-only and mixed sale
   write **zero** StockMovements for quick lines and touch no Item.stock; total correct; credit
   khata owes full total. **This is the load-bearing money slice.**
3. **Profit-loop branching (the anti-006c core).** Add `kind!=="item"` skip to the two gross-
   profit loops (`dailyCloseService`, `reportsService`) and compute the separate
   `quickSalesRevenue`. Tests: gross profit of a sale **+ a quick line** equals the same sale
   **without** it (adds 0); revenue/cashSales/Expected-cash include the quick revenue;
   `quickSalesRevenue` equals Σ quick lineTotals net of voids; item-performance shows no quick
   per-item row.
4. **Reporting surface + void + history label.** Daily Close + Reports UI (separate quick-sale
   figure, synthetic "Quick sales (uncatalogued)" row, profit "—"); `voidSale` stock filter to
   item lines; `saleItemsLabel` uses quick `name`; POS "Quick item" entry. Tests: void of a mixed
   sale reverses cash/khata, restores stock for item lines only; label renders quick names.
   Real browser verification (post a mixed sale; confirm drawer vs gross-profit vs net behave as
   §9 states) before the final commit.
