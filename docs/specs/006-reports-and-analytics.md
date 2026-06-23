# Spec: 006 — Reports & analytics

- **Status:** draft (pending review)
- **Phase:** Phase 6 — Reports & analytics
- **Author / date:** <you> / <fill in>
- **Builds on:** every prior phase. Reuses the `[start, end]`-parameterized aggregation pattern
  from spec 005 (built that way deliberately for this phase). Reuses `formatPaisa`,
  `ASIA_KARACHI_OFFSET_MIN`, `createdAt`-bucketing (ADR-010). Reads from immutable Sale (incl.
  `costAtTime` snapshots, `voided` flag), CustomerReturn, Expense, CustomerPayment,
  SupplierPayment, Purchase, Item. Writes nothing to any existing collection.

## 1. Problem / goal
Daily close (spec 005) answers two questions about today. The owner also needs to answer the
same two questions about wider windows:

1. **How is the business doing?** Net profit this week / this month, trend over time, compared
   to last month.
2. **What's driving it?** Which items sell the most (by qty, by revenue, by profit). Which
   items are dead stock. Where the money is going (expense breakdown). Who owes the most
   (top khata balances).

All the data exists, immutable and correct, in prior phases. Nothing's aggregated for windows
longer than a day. This phase is the aggregation + presentation layer.

## 2. Why this is different from prior phases (read first)
**There is no new correctness work in this spec.** Every number this phase displays is derived
from already-immutable, already-correct source data:
- Per-sale profit uses `unitPrice − costAtTime` (snapshotted at sale time, never recomputed —
  ADR from spec 004).
- Voided sales are excluded the same way as in spec 005.
- Customer returns reduce profit on the day of the return, not the sale day (same rule as 005).
- Cash flows are not the focus here (that's daily-close's job) — this phase is about
  profit, revenue, item performance, and balances.

**No new models, no transactions, no avgCost interaction, no day-boundary subtleties beyond
what spec 005 already solved.** This is the lightest spec since 004b's polish slice. The risk
is *over-building* — too many charts, too many filters, too much novelty. Default to fewer,
clearer views that answer real owner questions.

## 3. User stories
- As the owner, I want to see profit, revenue, and expenses for this week / this month / a
  custom range, and how they compare to the previous comparable window, so I know whether the
  business is up or down.
- As the owner, I want to see a trend chart (profit per day across the selected window) so I
  can spot good and bad days at a glance.
- As the owner, I want to see top-selling items (by qty, by revenue, by profit) so I know what
  to keep in stock and what to push.
- As the owner, I want to see dead stock (items that haven't sold in N days) so I can decide
  whether to discount or stop reordering.
- As the owner, I want to see an expense breakdown (by category) for the window.
- As the owner, I want to see top khata balances (who owes the most, biggest store credits)
  so I can follow up on collections.
- As the owner, I want all of this to be read-only, fast, and not interfere with anything else.

## 4. Scope
**In scope — one Reports screen with four sections:**

1. **Window controls** — segmented picker: Today / This week / This month / Last month /
   Custom range. Date pickers appear for Custom. Defaults to "This month."

2. **Headline numbers** — four big tiles:
   - Revenue (Σ non-voided sale totals in window, net of returns)
   - Gross profit (Σ per-line `(unitPrice − costAtTime) × qty`, net of returns)
   - Expenses (Σ Expense.amount)
   - Net for window (gross profit − expenses)
   Each tile shows the absolute number plus a small "vs. prior comparable window" delta
   (e.g. "+12% vs last month" or "−Rs 4,200 vs last week"). Color: green if up, red if down,
   grey if comparable window had no data.

3. **Trend chart** — single line/bar chart, profit per day across the window (Recharts).
   Hovering a day shows revenue, profit, expenses for that day. Click a day to drill through
   to that day's Daily Close view.

4. **Item performance** — table, sortable by qty sold / revenue / gross profit. Default sort:
   profit descending. Columns: item name, SKU, qty sold, revenue, gross profit, current stock.
   Top 20 rows + "show all" expand. Below the table: a separate "Dead stock" section listing
   items with zero sales in the window AND current stock > 0 (so the owner sees what's
   gathering dust).

5. **Expense breakdown** — small horizontal bar chart by category (salary | electricity |
   other), with totals.

6. **Khata snapshot** — two small lists side by side: top 10 customers by balance owed (who
   owes the most), top 10 by store credit (where you owe). Same shape for suppliers below it.
   Each row links to that customer/supplier's existing ledger detail screen.

**Out of scope:**
- **Receipts, printouts, PDF export.** Owner reads on screen. Export is its own spec later if
  ever needed.
- **Per-item profit chart over time.** Useful eventually, not v1. The item performance table
  answers the same question with less code.
- **Per-customer profit / margin analysis.** Customers don't have a "profit per customer"
  notion yet, and adding one risks moving the goalposts on per-sale profit (which is
  deliberately locked-in). Out for v1.
- **Forecasting, reorder suggestions, AI-driven insights.** Phase 7 (AI layer) territory.
- **Scheduled reports, email digests.** Not in this app's scope.
- **Multi-shop comparison.** Single shop.
- **Editing or correcting data from the Reports screen.** Strictly read-only — corrections
  happen via the existing reverse/void/return flows.

## 5. Data model changes
**None.** This spec adds no collections, no fields, no indexes beyond what already exists.

If query performance becomes a problem on larger date ranges (unlikely at this shop's volume
for at least the first year), consider adding compound indexes on (createdAt, voided) for
Sale and (createdAt) for Expense — but only after measuring, not pre-emptively. Flag for
future optimization, do not add now.

## 6. Business rules
- **All windows use Asia/Karachi day boundaries**, bucketed by `createdAt`. Same rule and
  same constant as spec 005 (ADR-010). "This week" = Mon 00:00 to Sun 23:59:59.999 Karachi.
  "This month" = 1st 00:00 to last-day 23:59:59.999 Karachi.
- **Prior comparable window** for the delta:
  - This week → last week (Mon–Sun preceding).
  - This month → last month (1st to last-day of prior month).
  - Today → yesterday.
  - Custom range → the immediately preceding range of the same length.
- **Voided sales are excluded** from every aggregation (revenue, profit, item performance).
- **Customer returns reduce revenue and profit on the day of the return**, not the sale day
  (consistent with spec 005). This means a return on a sale from outside the window still
  affects the window's totals if the return itself falls inside it.
- **Item performance "qty sold"** = qty sold in window − qty returned in window. "Revenue" =
  revenue from sales in window − refund value from returns in window. "Gross profit" =
  per-line profit on sales in window − per-line profit reversed by returns in window. Same
  netting principle throughout.
- **Dead stock criterion**: zero qty sold in the selected window AND current stock > 0.
  Surface, don't filter — owner decides what to do.
- **Top khata lists**: sorted by absolute balance descending; one list for positive balances
  ("they owe you"), one for negative ("store credit / you owe"). Top 10 each.
- **All money displayed via existing `formatPaisa` helper.** No new formatters.
- **All aggregation is computed on read.** No denormalization anywhere. Same principle as
  daily close.
- **Owner-only.** Same gating as every other read-mostly screen.

## 7. Validation rules
- Window param: `today | this_week | this_month | last_month | custom`. If `custom`, require
  `start` and `end` dates, both real, both not in the future, `start <= end`. Reject anything
  else.
- No write endpoints in this spec; nothing else to validate.

## 8. Acceptance criteria (checklist)
- [ ] Window picker switches the entire screen's data correctly for Today / This week / This
      month / Last month / Custom.
- [ ] Headline tiles compute revenue, gross profit, expenses, net correctly for each window,
      and match a hand-calculated value on a small dataset (regression-test against summed
      per-sale profit from Sale History for the same window).
- [ ] Voided sales are excluded from every aggregation.
- [ ] Customer returns reduce the right window's revenue + profit, not the original sale's
      window (regression: return today on last-month's sale lowers *this month's* numbers).
- [ ] Prior-window delta computes correctly for each preset (today→yesterday, week→prior
      week, month→prior month, custom→preceding-equal-length range).
- [ ] Delta shows green/red/grey correctly, and handles the "prior window has zero" case
      gracefully (no division by zero in the % display).
- [ ] Trend chart renders one bar/point per day in the window, with correct daily profit.
- [ ] Clicking a day on the trend chart navigates to that day's Daily Close view.
- [ ] Item performance table is sortable by qty / revenue / profit, defaults to profit desc,
      shows top 20 with expand-to-all.
- [ ] Item performance numbers net out returns correctly (regression: sell 10, return 2,
      table shows qty 8 and profit accordingly).
- [ ] Dead stock list shows only items with zero window sales AND positive current stock.
- [ ] Expense breakdown chart shows correct category totals; sum equals headline Expenses
      tile.
- [ ] Khata snapshot lists show correct top-10 by absolute balance, with sign respected
      (positive list ≠ negative list), and link through to customer/supplier detail.
- [ ] All amounts display via `formatPaisa`.
- [ ] Owner-only gating on the route and on every endpoint.
- [ ] The screen does not modify any data — verified by checking no write endpoints exist
      for this feature.
- [ ] Performance: the screen for a one-month window with realistic data (a few hundred
      sales, dozens of returns, dozens of expenses) renders in well under a second.

## 9. Open questions (resolve in review)
1. **Should the trend chart show profit only, or stacked profit + expenses + net?** Leaning:
   single profit line for v1 (clearest answer to "how am I doing"); add overlays only if the
   single line proves insufficient. Confirm.
2. **Dead stock window**: should "dead" be based on the selected window (e.g. "no sales this
   month") or a fixed lookback like 30/60/90 days regardless of window? Leaning: tied to the
   selected window, so the owner can ask "what didn't sell last month" by selecting it.
   Confirm.
3. **Top khata lists**: 10 rows enough, or more / configurable? Leaning: 10 each, "show all"
   link goes to existing Customers / Suppliers screens.
4. **Should the Reports screen replace the existing Negative Stock view, or stay separate?**
   Leaning: stay separate — Negative Stock is an operational alert, Reports is analytical.
   Confirm.
5. **Aggregation service shape**: one big `getReport(window)` endpoint that returns
   everything, or several smaller endpoints (`/reports/headline`, `/reports/trend`,
   `/reports/items`, `/reports/expenses`, `/reports/khata`)? Leaning: one endpoint, one
   round-trip, simpler frontend. Several endpoints would only be worth it if any one query
   becomes slow enough to want independent caching — premature for v1. Confirm.
6. **Default window**: This month (leaning) vs This week vs Today. The owner will most often
   want "how's the month going" since that's his salary/rent comparison frame. Confirm.

## 10. Notes / decisions
- This spec adds NO new correctness-critical machinery. The §8 acceptance list is mostly
  "did the aggregation get the same answer as summing the source data by hand."
- The §2 verification ask for review: confirm against the actual code that (a) the spec 005
  aggregation service is genuinely range-parameterized and can be reused here without
  refactor, (b) Sale.lines.costAtTime is read everywhere profit is computed (never
  Item.avgCost), and (c) the CustomerReturn netting math from spec 005 generalizes to wider
  windows without change.
- Build order: backend aggregation service first (mostly extending what spec 005 already has
  to handle the new groupings — item-level, category-level, khata-balance ranking), with
  the full §8 test list. PAUSE on green. Then routes + controllers. Then the frontend:
  window picker → headline tiles → trend chart → item table → expense breakdown → khata
  snapshot, in that order, verifying each section in the browser before moving on. Recharts
  is already a stack dep; no new packages.
- After ship: write up the "no denormalization, all aggregation computed on read" principle
  in DECISIONS.md (ADR-011) — this is the third spec in a row using this pattern (005, the
  004b returns indicator, now 006), enough to elevate to an explicit ADR rather than reasoned
  case-by-case.
- Phase 7 (AI layer) becomes much easier after this ships: an AI assistant asked "how's the
  shop doing?" can call the same `/reports` endpoint as the screen does, and reason over the
  same numbers the owner sees. Designing the endpoint with that in mind (clean JSON shape,
  no presentation logic) costs nothing now and saves a refactor later.