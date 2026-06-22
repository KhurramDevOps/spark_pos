# Spec: 005 — Expenses & daily close

- **Status:** draft (pending review)
- **Phase:** Phase 5 — Expenses & daily close
- **Author / date:** <you> / <fill in>
- **Builds on:** every prior phase. Reads from immutable Sale (totals, costAtTime for profit),
  CustomerPayment, SupplierPayment, CustomerReturn (cash refunds), Sale.voided (exclude voided
  sales from the day's math). Does NOT modify any existing model's behavior — this phase is
  purely new collections (Expense, DrawerAdjustment, DayClose) + a read-only aggregation screen.

## 1. Problem / goal
At the end of every shop day, the owner needs to answer two questions:

1. **Did the drawer balance?** Cash counted in the drawer should equal cash that should be there
   based on the day's recorded flows. If it doesn't, something happened that wasn't recorded
   (theft, miscount, missed transaction, forgot to log an expense).
2. **Was the day worth it?** Gross profit (sales − cost) for the day, shown alongside expenses,
   so the owner sees real net for the day at a glance.

Three things block this today:
- **No place to record expenses.** Worker salary (Rs 15,000 monthly, paid in one lump at
  month-start), electricity bill, miscellaneous shop costs — all currently invisible to the
  system, so any cash math is wrong.
- **No place to record drawer adjustments.** Cash sometimes flows from home into the drawer
  (when the drawer is short and a supplier needs paying); cash flows out of the drawer to home
  most nights. Neither is a sale, expense, or supplier payment — they need their own concept.
- **No aggregation screen.** Daily totals exist scattered across Sale, CustomerPayment,
  SupplierPayment, CustomerReturn — never assembled in one place for the owner to read.

## 2. Why this is different from prior phases (read first)
Phases 1–3 were correctness-critical: money, stock, avgCost — every flow had a "must not lie"
property and the test list reflected that. **Phase 5 has very little new correctness work.** All
the source data (sales, payments, refunds, voids) is already captured correctly and immutably
from prior phases. This phase is mostly:

- A flat Expense collection (no ledger, no running balance — see §5).
- A flat DrawerAdjustment collection (cash in / cash out between shop and home).
- A tiny DayClose collection (one row per closed day, holds the actual-counted cash that
  carries forward as tomorrow's starting cash — see §6).
- A read-only aggregation that pulls today's numbers from existing collections + the three new
  ones, and presents them.

**No transactions span multiple collections in this spec.** Recording an expense is a single
insert. Recording a drawer adjustment is a single insert. Saving a day's close is a single
upsert. The daily-close VIEW writes nothing. This is intentional — the "audit by aggregation,
not denormalization" principle from 004b's returns indicator applies here too: the daily close
math is computed on read from immutable sources, and only the actual-counted cash is persisted
(because that's a real-world fact only the owner can know).

The one piece of real care needed: **timezone**. "Today" must be Asia/Karachi, not server UTC,
or a 7pm sale will land on the wrong day in the close screen. Detailed in §6.

## 3. User stories
- As the owner, I want to record a shop expense (salary, electricity, misc) at the moment it
  happens, with category and amount, so the day's cash math accounts for it.
- As the owner, I want to record taking cash home from the drawer at night, AND bringing cash
  from home to the drawer when needed for a supplier payment, so the daily-close math reflects
  reality.
- As the owner, I want to see at the end of the day: starting cash (the loose float that's
  always in the drawer, carried from yesterday's close), all the flows in and out (sales,
  customer payments received, supplier payments made, expenses, refunds, drawer adjustments),
  and what the drawer *should* contain right now.
- As the owner, I want to type in what the drawer *actually* contains, and see the difference
  immediately (and in red if it's short).
- As the owner, I want today's actual-counted cash to automatically become tomorrow's starting
  cash, because there's always a loose float in the drawer that I don't want to re-type.
- As the owner, I want to see the day's gross profit alongside expenses, so I know whether the
  day was actually worthwhile, not just whether the cash balanced.
- As the owner, I want to view any past day's close, not just today's — to chase down a
  discrepancy I noticed days later.

## 4. Scope
**In scope:**
- **Expense model + recording flow:** flat (no ledger, no running balance, no recipient
  collection). Fields: date, category, amount (paisa), note, createdBy.
- **DrawerAdjustment model + recording flow:** flat. Fields: date, direction (in / out),
  amount, note, createdBy. ("in" = cash from home to drawer; "out" = cash from drawer to home.)
- **DayClose model (new, tiny):** one row per closed day. Fields: date (unique), actualCash
  (whole paisa, what the owner counted), expectedCash (computed snapshot at close-time, for
  audit), difference (computed snapshot), closedBy, closedAt. Today's starting cash =
  yesterday's DayClose.actualCash. If no close exists for yesterday, fall back to the most
  recent prior DayClose; if none exists at all, default 0 and let the owner type the float.
- **Daily close screen (read-mostly aggregation):** the cash math table + the gross profit line
  + the "actual cash counted → difference" interaction + a "Close day" button that upserts
  today's DayClose row. View today by default; date picker for any past day.
- **Expense category list:** small enum to start (`salary`, `electricity`, `other` — confirm in
  review). Not a separate collection — just a constant on the Expense model. Owner can add
  free-form note for context.
- **List/edit/delete expense within the same day:** mistakes happen at entry time. After a day's
  close has been saved, expenses on that day stay editable (no day-locking per §6 below), but
  the UI should warn ("editing a past-day expense will change that day's expected cash and
  affect the carried-forward float").

**Out of scope:**
- **Day locking / "closed" state preventing further edits.** Saving a DayClose is purely a
  read-mostly snapshot + carrying-forward-the-float; it does NOT prevent voids, returns, or
  expense edits on that day. If a retroactive edit happens, re-saving the close updates the
  snapshot. If this ever needs to change, it's its own spec.
- **Multi-currency, multi-drawer, multi-shop.** Single shop, single drawer, PKR.
- **Salary accrual / smoothing.** Salary is recorded as one lump-sum expense on the day it's
  paid (month-start). The day it's paid will look unusually expense-heavy, which is correct.
- **Linking an Expense to a recipient (e.g. the worker as a "person").** Workers aren't
  modeled. The expense has a category and a note; that's enough.
- **Receipt / printout of the daily close.** Phase 6 (reports) territory if ever needed.
- **Net profit per Sale / per Item.** The existing per-sale gross profit (sales − COGS) stays
  as-is. Expenses are a daily-level concept, NOT folded into the existing profit field on Sale
  (would muddy the per-sale numbers we've worked hard to keep honest). See §6 "profit & expense
  stay separate."

## 5. Data model changes
- **Expense (new, flat — no ledger, no balance):**
  - `_id`
  - `date` (Date, user-editable label for what day it belongs to; daily-close math uses this
    after timezone-normalizing — see §6)
  - `category` (enum: `salary` | `electricity` | `other` — confirm in review)
  - `amount` (whole paisa, integer; reuse the shared rupees→paisa validator at the boundary,
    exactly like Sale total)
  - `note` (string, optional)
  - `createdBy` (ref User; owner-only for now, same gating as imports/recalc-cost)
  - `createdAt`, `updatedAt`

- **DrawerAdjustment (new, flat):**
  - `_id`
  - `date` (Date, user-editable label, same treatment as Expense.date)
  - `direction` (enum: `in` | `out`)
  - `amount` (whole paisa, integer)
  - `note` (string, optional — e.g. "for Rafiq supplier payment", "took home for the night")
  - `createdBy`
  - `createdAt`, `updatedAt`

- **DayClose (new, tiny — persists the carried-forward float):**
  - `_id`
  - `date` (Date, unique — one close per day; index unique on date-normalized-to-Asia/Karachi
    midnight)
  - `actualCash` (whole paisa, what the owner counted at close — this is what carries forward as
    next morning's starting float)
  - `expectedCashSnapshot` (whole paisa, the computed expected cash at the moment of close — for
    audit; not recomputed afterwards)
  - `differenceSnapshot` (whole paisa, signed; actualCash − expectedCashSnapshot at close-time)
  - `note` (string, optional — owner can explain a discrepancy)
  - `closedBy` (ref User)
  - `closedAt`, `updatedAt`

- **No changes to Sale, Purchase, Customer, Supplier, CustomerReturn, CustomerPayment,
  SupplierPayment, Item, StockMovement, Settings.** This spec adds three collections and a
  screen; it does not touch the existing ones.

- **Indexes:** `Expense.createdAt` and `DrawerAdjustment.createdAt` for fast daily-range queries
  (the `date` field is the user-editable label; bucketing is by `createdAt` per §6).
  `DayClose.date` unique.

## 6. Business rules
- **"Today" is Asia/Karachi, by createdAt.** Same rule as everywhere else in the project —
  daily-close aggregation buckets transactions by `createdAt` after converting to Asia/Karachi
  timezone, NOT by any user-editable date label. A sale posted at 11:55pm shop-time on June 23
  belongs to June 23's close, even if the server is UTC and the user-set date field is
  different. Pin the timezone explicitly in a constant; do not let it default to server local.

- **"Day boundary"** is Asia/Karachi 00:00:00 to 23:59:59.999. The day starts at midnight, not
  at an arbitrary "shop open" time. (Most days the shop will be closed across the boundary
  anyway; this just defines the bucket precisely.)

- **Starting cash for the day = yesterday's actual-counted cash.** Persisted as DayClose.
  actualCash. There's always a loose float in the drawer (owner has confirmed); typing it every
  morning would be tedious and error-prone. The rule:
  - If a DayClose row exists for the immediate prior day, today's starting cash = that row's
    `actualCash`.
  - If not (e.g. shop was closed yesterday, or no close was saved), walk backwards to the most
    recent DayClose and use its `actualCash`.
  - If no DayClose exists at all (first-ever use of the app), starting cash defaults to 0 and is
    editable on the screen — owner types the current loose float once, then it self-perpetuates
    from then on.
  - Starting cash is **displayed** on the screen but **not directly editable for past days** —
    to change it, the owner edits the prior day's close (which warns about the cascade).

- **The cash math (exact formula, what the screen displays):**

  ```
  Starting cash in drawer            Rs X     (from prior day's DayClose.actualCash)

  + Cash sales today                  Rs A    Σ Sale.total WHERE
                                              paymentType='cash' AND voided=false AND
                                              createdAt ∈ [day_start, day_end]
  + Customer payments received        Rs B    Σ CustomerPayment.amount (cash, today)
  + Drawer adjustments IN             Rs C    Σ DrawerAdjustment.amount WHERE direction='in'

  − Cash refunds (customer returns)   Rs D    Σ CustomerReturn.total WHERE
                                              refundMethod='cash' AND today
  − Supplier payments made (cash)     Rs E    Σ SupplierPayment.amount (cash, today)
  − Expenses                          Rs F    Σ Expense.amount today
  − Drawer adjustments OUT            Rs G    Σ DrawerAdjustment.amount WHERE direction='out'

  = Expected cash in drawer           Rs Y    X + A + B + C − D − E − F − G

  Actual cash counted                 Rs Z    (owner types in; persisted via Close day button)
  Difference                          Rs (Z−Y)   red if negative, green if positive,
                                                 grey/zero-styled if exactly zero
  ```

  Each line is itself clickable / expandable to show the underlying transactions for that day
  (so a Rs 12,400 "Cash sales today" line shows the list of sales that summed to it). Same
  principle as the khata ledger detail in spec 004.

- **Close day button:** upserts a DayClose row for the viewed date with actualCash (what the
  owner typed), expectedCashSnapshot (the computed Y at click-time), differenceSnapshot (Z−Y),
  closedBy, closedAt. Idempotent — clicking again on the same day updates the existing row.

- **Voided sales are excluded from cash sales for the day they were sold on.** A sale posted
  yesterday and voided today: subtract from today's "drawer adjustments OUT" effect? No — much
  simpler: the void's reversing effect on cash is implicit because the original cash sale is
  excluded from its own day's math once voided. The day of the void itself shows no expense or
  adjustment (the cash hasn't physically moved in the world if the customer hasn't been
  refunded). This is correct behavior, but owner-facing implications need calling out: voiding
  yesterday's cash sale changes yesterday's close, not today's. The close screen should be
  re-checked for the affected day after any retroactive void/return — and if yesterday's
  DayClose was already saved, the screen should flag that the snapshot is now stale and prompt
  a re-save.

- **Profit & expense stay separate.** Two distinct lines on the screen:
  - `Gross profit today` = Σ (Sale.line.unitPrice − Sale.line.costAtTime) × qty for
    non-voided sales today. (Same formula as per-sale profit in the existing UI; sum it.)
  - `Expenses today` = Σ Expense.amount.
  - `Net for the day` = Gross profit − Expenses. (Display only; not stored anywhere.)
  - **Do not fold expenses into Sale.profit or any existing field.** Per-sale gross profit
    stays as it is; net profit is a daily-level derived view. This decision belongs in
    DECISIONS.md (ADR-009).

- **Profit excludes voided sales and accounts for returns.** Voided sale's lines are excluded
  entirely. A partial customer return's effect on profit: subtract `(returnedQty × (unitPrice −
  costAtTime))` for each returned line from the day the RETURN happened, NOT the day of the
  original sale. (Match the cash math principle: things hit the day they actually happen.)

- **Expenses are immutable in spirit but editable in v1.** Same as prior phases: ideally an
  expense, once recorded, is corrected via a reversing entry rather than edited. But for v1
  pragmatism, allow edit/delete on same-day expenses with an obvious warning if the day's been
  closed. Re-evaluate after a month of use; if mistakes are rare, no need to add the reversal
  ceremony.

- **No transaction needed.** Expense, DrawerAdjustment, and DayClose writes are all
  single-collection inserts/upserts. No `session.withTransaction` ceremony — that rule is for
  multi-collection writes per ADR-001.

- **Owner-only.** Recording an expense or drawer adjustment, viewing the daily close, and
  saving a close are all owner-gated (same TODO-real-auth placeholder as the rest of the app).

## 7. Validation rules
- Expense: amount > 0 (paisa, integer); category ∈ enum; date present (defaults to today);
  createdBy required; note optional, max length.
- DrawerAdjustment: amount > 0; direction ∈ {in, out}; date present; createdBy required.
- DayClose: actualCash >= 0 (it's a count of money — can be zero on a closed-shop day, never
  negative); date present; closedBy required.
- Reuse `shared/validation/money.js` for rupees→paisa at the boundary (same as Sale, Purchase,
  CSV import — single conversion path).
- Daily-close view takes a date param (defaults to today in Asia/Karachi); validate it's a real
  date and not in the future.

## 8. Acceptance criteria (checklist)
- [ ] Recording an expense persists with correct amount-in-paisa, category, date, createdBy.
- [ ] Recording a drawer adjustment (in or out) persists likewise.
- [ ] Editing/deleting a same-day expense works and the close screen reflects it on next view.
- [ ] Daily close for "today" correctly aggregates every line of §6's formula against the right
      Asia/Karachi day boundary — including the case where a sale is at 11:55pm shop time and
      server UTC puts it on the next day.
- [ ] Cash sales line excludes voided sales.
- [ ] Cash refunds line picks up CustomerReturns with refundMethod='cash' only (khata-credit
      returns must NOT appear here — they don't move cash).
- [ ] Supplier payments line picks up cash supplier payments only (confirm the as-built model's
      representation of "cash" in §9 review).
- [ ] Customer payments line picks up cash customer payments received (confirm likewise in §9).
- [ ] Gross profit aggregation matches sum of per-sale profits visible in Sale History for that
      day, sale-by-sale (regression: same numbers, different presentation).
- [ ] Past-day view works for any prior date, with the same correctness.
- [ ] Voiding yesterday's cash sale, then viewing yesterday's close, shows the sale removed
      from yesterday's cash sales line (and yesterday's expected drawer accordingly lower).
- [ ] If yesterday's DayClose was already saved, voiding a yesterday sale flags the snapshot as
      stale on yesterday's close screen.
- [ ] A customer return on cash sale (today) shows up in today's "cash refunds" line.
- [ ] The "actual cash counted" input + "difference" line compute correctly and display the
      right colors at zero / positive / negative.
- [ ] Clicking "Close day" upserts a DayClose row with the right actualCash,
      expectedCashSnapshot, differenceSnapshot. Clicking again updates (idempotent).
- [ ] Today's starting cash equals yesterday's DayClose.actualCash automatically; first-ever
      use defaults to 0 and is editable, then self-perpetuates.
- [ ] If yesterday has no close row but the day before yesterday does, today walks back to find
      the most recent and uses its actualCash.
- [ ] Recording an expense, a drawer-in, and a drawer-out, then refreshing the close, shows
      each affecting the cash math in the right direction.
- [ ] All amounts display as Rs ₹X,XXX.XX (the existing `formatPaisa` helper, not reinvented).
- [ ] Owner-only gating on all flows (record expense, record drawer adjustment, view close,
      save close).
- [ ] No new test depends on a Mongo transaction (this spec doesn't use them).

## 9. Open questions (resolve in review)
1. **Expense categories — what's the v1 list?** Owner has confirmed `salary` and `electricity`
   are the main two; `other` covers the rest with a free-form note. Is that enough for v1, or
   should categories be a tiny separate collection (admin-editable) instead of an enum? Leaning:
   enum for v1, promote to collection only if owner ends up needing many categories. Confirm.
2. **Cash supplier payments — how does the existing SupplierPayment model represent "cash" vs.
   non-cash?** Check the as-built model: is there a method/type field, or is everything stored
   as cash by default in v1? If the latter, daily-close treats them all as cash; if there's
   already a method field, daily-close filters on it. Verify in review against actual code.
3. **Same question for CustomerPayment** — does the as-built distinguish cash receipts from
   non-cash, or treat everything as cash? Verify.
4. **What happens if the user enters an expense dated to a future date?** Block (date validation
   in §7 says no future dates). Confirm this is the right default — could be relaxed for
   "scheduled" expenses but those aren't a v1 concept.
5. **Display: do we show a single combined close screen, or split daily-close (cash math) and
   daily-summary (sales, profit, expenses) into two views?** Leaning: one screen, sections.
   Confirm.
6. **DayClose recompute on retroactive change:** if yesterday's DayClose was saved with
   expectedCashSnapshot = Rs 8,200, and today a void retroactively changes yesterday's expected
   to Rs 7,900, what's the UX? Options: (a) auto-recompute the snapshot silently — loses audit;
   (b) flag stale and prompt re-save — preserves audit, owner-aware. Leaning: (b). Confirm.

## 10. Notes / decisions
- This spec adds NO new correctness-critical machinery — no transactions, no replay, no avgCost
  interaction. It's almost entirely a read-only aggregation layered over already-correct data,
  with one tiny new collection (DayClose) for persisting the carried-forward float.
- The review should focus on (a) the timezone handling, (b) confirming the existing
  CustomerPayment / SupplierPayment models actually represent "cash" the way §6 assumes they do
  (Q2, Q3), and (c) the edge case of retroactive voids/returns affecting past-day closes (Q6).
- Build order: models + validation for Expense + DrawerAdjustment + DayClose first, with their
  tests (record, list, edit, delete, validation rejections). Then the aggregation service with
  the full §8 acceptance list — particularly the timezone boundary test, the voided-sale-
  exclusion test, and the carried-forward-float test. PAUSE on green. Then routes + controllers.
  Then the UI: a small record-expense form, a drawer-adjustment form, and the close screen.
  Verify in browser by doing a real day end-to-end (post some sales, record salary, record a
  drawer-in for a supplier payment, count cash, see the difference, save the close, open
  tomorrow's view and confirm the float carried forward).
- After ship: write up the new collections, the "expenses stay separate from per-sale profit"
  decision, and the "starting cash auto-carries via DayClose" decision in DECISIONS.md
  (ADR-009 or whatever the next number is).
- Phase 6 (reports) will reuse the same aggregation logic across longer windows (week, month).
  The aggregation service should be written with that in mind — parameterized by start/end
  range, not hardcoded to "one day."