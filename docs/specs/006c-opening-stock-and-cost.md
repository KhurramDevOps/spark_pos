# Spec: 006c — Opening stock & unit cost (the real-world "I already have inventory" gap)

- **Status:** in-progress (review complete; review fixes incorporated; building costService
  + StockMovement enum slice first)
- **Phase:** Phase 6 polish (final, before Phase 7 AI). Same discipline tier as 003b / 004b /
  006b — fixes a real correctness gap surfaced by real shop usage.
- **Author / date:** <you> / <fill in>
- **Builds on:** Item model (spec 001), CSV bulk import (spec 002), Purchase + weighted-
  average cost engine (spec 003), the replay-from-movements engine in costService (spec
  003b — load-bearing for this spec), every model that snapshots cost. Touches NO money
  movement (no supplier/customer ledger). Adds one new StockMovement type and three new
  entry paths.

## 1. Problem / goal
The shop has ~200 items in inventory **right now**, bought over months/years, with no
preserved purchase receipts but with the owner knowing roughly what each one cost. The
existing app forces every item to enter inventory via a Purchase, which:

- Creates a fake supplier debt that never existed (the items aren't owed to anyone — they
  were paid for long ago).
- Forces the owner to make up purchase dates and supplier names just to get cost data in.
- Doesn't model what's actually happening — these aren't new purchases, they're **existing
  inventory being declared into the system at the moment of switching to the app**.

The current workaround — entering items with cost = 0 and "fixing it later via a real
purchase" — is **actively wrong**: it corrupts avgCost via weighted-average dilution.

**Concrete failure case (already visible in the owner's real test data):**
- Item entered manually: 15 units, retailPrice Rs 300, **avgCost = 0** (no other choice).
- Later, owner buys 15 more from a real supplier at Rs 250 each (real purchase).
- avgCost after replay: (15 × 0 + 15 × 250) / 30 = **Rs 125** — half the real cost.
- Every sale of this item from now on overstates profit by ~100%. Sales reports lie.
- recalculate-cost reports zero drift because the *replay* is consistent — the **data
  going into the replay** was wrong from the start.

This is the most consequential bug surfaced by real-shop usage so far. It must be fixed
before AI (Phase 7) is built on top of these numbers, because AI reasoning over lying
profit figures will produce worse answers, not better ones. And it must be fixed before
your father imports the real ~200-item CSV, because once corrupt opening data is in,
every future sale on those items propagates the lie.

**Goal:** make declaring existing inventory (with its real per-unit cost) a first-class
operation — at item creation, in CSV bulk import, AND as a repair tool for items already
in the system with wrong avgCost.

## 2. Why this spec needs careful architectural attention
The replay engine (spec 003b) is the **single source of truth** for avgCost correctness:
walks StockMovements in posting order, recomputes the running weighted average at
**purchase-type events**, ignores non-purchase movements except to carry quantity. That
discipline must extend cleanly here.

Three architectural pieces are load-bearing:

1. **A new StockMovement type `opening`** that the replay engine treats **identically to
   `purchase`** for cost purposes. Not a special case bolted on — a clean addition to the
   "purchase-type events" set inside costService. This is the only place in the codebase
   that needs to change to make replay correct.
2. **Opening movements are immutable once created**, same as Purchase and Sale. Mistakes
   are corrected via a dedicated "edit opening" flow (which deletes the old opening
   movement and creates a new one in the same posting order, then triggers a replay).
   This is the only place in the spec where mutation of an existing movement is allowed,
   and it's gated behind an explicit owner-only repair endpoint.
3. **No supplier involvement.** Opening stock is NOT a Purchase. It does not create a
   Supplier, doesn't move a Supplier.balance, doesn't appear in supplier ledgers. It's a
   pure inventory + cost declaration, full stop.

The CSV path needs the same care: two new optional columns must integrate with the
existing two-phase preview→commit flow without forking validation, and must produce the
same shape of StockMovement(s) as the manual single-item path.

Everything else (UI, validation, owner-gating) is straightforward.

## 3. User stories
- As the owner setting up the shop in SparkPOS for the first time, I want to declare the
  ~200 items I already have, with the qty I have on hand AND the unit cost I paid for
  them, in one CSV import — and have the system know each item's correct avgCost from
  day one, without inventing fake purchases or fake suppliers.
- As the owner adding a single new item later, I want the option to declare an opening
  stock + cost at create time (e.g., "I just found 5 more of these in the back room and
  I know they cost Rs 200 each three months ago"), without entering a Purchase.
- As the owner who already has items in the system with wrong avgCost (because earlier I
  entered them with cost = 0), I want a clean repair path to fix them — declare the
  correct opening cost retroactively, let the replay engine recompute, see the corrected
  avgCost reflected everywhere.
- As the owner running recalculate-cost, I want the report to reflect the opening
  movement's effect correctly — no drift after a repair.

## 4. Scope
**In scope — three entry paths + one new movement type:**

1. **New StockMovement type: `opening`.**
   - Fields (same shape as existing movements): `itemId`, `type: 'opening'`, `qty`
     (positive Decimal128), **`costAtTime`** (Decimal128 — the per-unit cost being
     declared, stored in the SAME field purchases use; there is no separate `unitCost`
     field — see §5), `date` (user-supplied, default today), `note` (optional),
     `createdBy`, `createdAt` (server-set, the posting-order anchor).
   - The API/UI input is named **`openingUnitCost`** for clarity; it is persisted as
     **`costAtTime`** on the StockMovement.
   - **Treated as a purchase-type event** by costService's replay (the only behavioral
     change to the engine — see §6). The replay's existing null/negative-cost guard
     (it throws on a cost-bearing movement missing/with-negative `costAtTime`) extends
     to `opening` as well.

2. **Manual single-item path: opening fields on Add/Edit Item modal.**
   - When CREATING an item: optional "Opening stock" section with `openingQty` and
     `openingUnitCost` inputs. If filled, the create transaction also writes one
     `opening` StockMovement (qty = openingQty, `costAtTime` = openingUnitCost) and sets
     the item's stockQty + avgCost in that same transaction.
   - **`createItem` change (going forward):** when opening fields are provided, emit a
     `type: 'opening'` movement carrying `costAtTime`, NOT the legacy
     `type: 'adjustment'` movement noted `"opening stock"` that the current code writes.
     This stops the broken (cost-less) legacy shape from being created from day one;
     existing legacy rows are cleaned up by the repair tool (path #4). See §10.
   - When EDITING an item: the "Opening stock" section is replaced by a separate
     **"Repair opening cost"** action (owner-only, behind a confirmation), described in
     §4 path #3 — editing is NOT a casual operation.
   - This means the create form has BOTH paths: the existing fields (no opening, item
     enters at qty 0 / avgCost 0 — current behavior, still valid) AND the new opening
     fields (declare what you have).

3. **CSV import: reuse the existing `openingStock` column for qty; add ONE new optional
   column `openingUnitCost`.** (The importer already has an `openingStock` column → it
   maps to the row's opening qty. Do not introduce a second `openingQty` column.)
   - If both empty → item created with stockQty 0, avgCost 0 (current behavior).
   - If both present → item created AND an `opening` StockMovement written (qty =
     openingStock, `costAtTime` = openingUnitCost), all in the same per-row transaction
     (the existing CSV importer is already per-row transactional — no architecture
     change, just an addition to the row's work).
   - If only one is present → row-level validation error ("openingStock and
     openingUnitCost must be set together"), surfaced in the existing preview UI.
   - `openingUnitCost` is rupees-decimal at the boundary (matches existing CSV money
     handling — converted via the shared `rupeesToPaisa` validator).
   - **⚠️ BREAKING contract change to existing CSV import:** today `openingStock` ALONE
     (no cost) is legal and produces the exact cost-less bug this spec exists to fix.
     After 006c, `openingStock` and `openingUnitCost` must be set together or both
     absent — `openingStock` alone is now a row-level error. This is intentional: it is
     the guard that prevents the bug recurring via CSV. (Safe in practice: the real
     ~200-item import hasn't happened yet, and it goes through this path fresh after a
     clean wipe.)
   - The owner's real-world ~200-item import IS the primary motivator for this path.

4. **Repair tool: owner-only "Set opening cost" for items already in the system.**
   - Visible only to owner, in the Item detail/edit screen as a separate red-tinted
     section: "This item's avgCost looks wrong? Declare its correct opening cost."
   - Inputs: `unitCost` (the corrected per-unit cost), `qty` (defaults to the item's
     current stockQty, editable in case it's also wrong), `date` (defaults to the
     earliest existing StockMovement.createdAt for this item, so the opening slots in
     as the FIRST event in the item's history), `note` (required for repairs — owner
     must explain why).
   - **Behavior — all in ONE transaction (one session):**
     1. Delete any existing `type: 'opening'` movement for this item (replace, not stack).
     2. **Delete any legacy `type: 'adjustment'` movement noted `"opening stock"` for
        this item** (the exact note the current `createItem` writes — see §10). This is
        the critical step: without it, the new opening stacks on top of the legacy
        cost-less adjustment and replay DOUBLE-COUNTS stock (e.g. 15 → 45) while only
        appearing to fix avgCost.
     3. Create the new `type: 'opening'` movement (`costAtTime` = corrected unit cost),
        with `createdAt` set to just before the earliest *remaining* movement (or `now`
        if none) so the engine sees it as the first event.
     4. Run **`recomputeItemCostByReplay(itemId, { session })`** (the PURE function) and
        persist the recomputed `avgCost` + `stockQty` to the Item — all inside this same
        session. **Do NOT call the `recalculateItemCost` wrapper** — it opens its own
        transaction; nesting it here is wrong. Reuse the pure replay function directly.
     5. Return the drift report (before/after avgCost + stockQty, changed flag), same
        shape as the existing recalculate-cost tool.
   - This is the cleanup path for the owner's already-broken test data, AND for any
     future "oops I entered cost = 0" mistakes. It's the only path in the entire
     codebase that deletes/replaces an existing StockMovement, and it does so by
     delete+recreate, not in-place edit.

**Out of scope:**
- **Multi-line opening declarations** ("I have 15 at cost A and 5 at cost B in the back
  room from different batches"). Single qty + single unit cost per opening declaration.
  If the owner has truly batched cost variance, that's a real Purchase pattern, not an
  opening — they can use Purchases for it.
- **Opening movements for purchases or sales retroactively.** No — that's what the
  existing reverse-purchase and customer-return flows are for. Opening is exclusively
  for "this stock existed before SparkPOS knew about it."
- **Bulk repair tool.** Repairing the corrupt items in the existing test data is done
  one item at a time via path #4. The owner has a small number of test items (single
  digits per the recent Reports screenshot), so a bulk tool is over-engineered. The
  real ~200-item import goes through the CSV path #3 fresh, after a clean wipe.
- **Opening stock for an item with existing non-opening movements** (sales, purchases,
  returns) via path #2 manual create — this can't happen by definition (create-time
  only, no movements exist yet). Only path #4 (repair) handles the "movements already
  exist" case, deliberately.
- **A "supplier name" field on opening** — opening is by definition supplier-less.
  Adding a name field would tempt the owner to use it as a fake-purchase path and
  defeat the point. The `note` field is sufficient if they want to record where it
  came from.

## 5. Data model changes
- **StockMovement.type enum** extended to include `opening`. Existing values
  (`purchase`, `sale`, `return`, `adjustment`, `reversal`) stay. The enum addition is
  the only schema change.
- **StockMovement** for an `opening` row: the per-unit cost is stored in the existing
  **`costAtTime`** field — the same field `purchase` rows use; `sale`/`return`/
  `adjustment`/`reversal` rows leave it null. **There is no `unitCost` field on
  StockMovement** (the model only has `costAtTime`). No new fields needed. The API/UI
  input `openingUnitCost` is persisted to `costAtTime`.
- **No new collection.** Opening is just another type of StockMovement.
- **Item** unchanged. avgCost and stockQty are computed/updated as before; just one
  more movement type can move them.
- **No new indexes.** The existing `{ itemId: 1, createdAt: 1, _id: 1 }` index
  (confirmed present on StockMovement) is what replay walks; opening movements use it.

## 6. Business rules
- **Opening is a purchase-type event for costService replay.** The only logic change to
  costService is: the recompute trigger grows from `{purchase}` to `{purchase, opening}`
  — a `COST_BEARING` set the replay loop checks instead of the current single
  `mv.type === "purchase"` comparison. The math is identical (`applyPurchaseToCost`
  reused verbatim; effectiveOld = max(oldQty, 0); scale + round-half-even per ADR-001).
  Cost is read from `mv.costAtTime` for both types. **The existing null/negative-cost
  guard** (throws on a cost-bearing movement whose `costAtTime` is missing or negative)
  **applies to `opening` too** — an opening with null/negative `costAtTime` is rejected
  by replay, never silently treated as 0. **Update the costService doc-comment** (it
  currently lists "adjustment (incl. opening stock)" among the non-cost-bearing,
  qty-only types) to state that `opening` is now cost-bearing alongside `purchase`.
- **Opening + Purchase + Reverse-purchase compose cleanly.** A real test case must
  verify: declare opening 15 @ Rs 200, then purchase 5 @ Rs 300, then reverse the
  purchase. After replay: avgCost = Rs 200 (the purchase is excluded by reversalRef,
  the opening remains, math is `15 × 200 / 15 = 200`). This is the proof that opening
  participates correctly in the existing reversal machinery without new code.
- **Opening movements respect the same posting-order rule** as everything else:
  `createdAt` asc, `_id` asc as tiebreak (ADR-001). They are NOT ordered by the
  user-supplied `date`. The repair tool deliberately sets `createdAt` to just before
  the earliest existing movement to ensure opening slots in as the FIRST event.
- **Repair tool's "createdAt just before earliest existing movement"** rule:
  - If no existing movements: createdAt = now.
  - If existing movements: createdAt = `min(existingMovements.createdAt) - 1ms`. This is
    sound and needs no `postingOrder` column: Mongo `Date` is **millisecond**-resolution,
    so subtracting a full 1 ms yields a strictly-smaller, distinct timestamp that sorts
    first by the **primary** sort key (`createdAt`) — `_id` tiebreak never even applies.
    Single-shop, single-millisecond contention for the same item is impossible. (Compute
    `min` against the movements that REMAIN after the legacy-adjustment deletion below.)
- **Repair tool always replaces the item's existing opening, in BOTH shapes** (one
  transaction): delete any `type: 'opening'` movement AND any legacy `type: 'adjustment'`
  movement noted `"opening stock"` for the item, THEN create the new `type: 'opening'`
  movement. Deleting the legacy adjustment is mandatory — otherwise the new opening
  stacks on top of it and replay double-counts stock (the bug this review caught; see
  §10). There can only ever be **one opening movement per item** afterward, by
  construction — assert `StockMovement.find({ itemId, type: 'opening' }).countDocuments()
  === 1` in tests; the replay engine never handles multiple openings.
- **CSV path with openingStock + openingUnitCost** writes the opening movement in the
  same per-row transaction as the Item create. Failure of either side rolls back both.
- **Manual create with opening fields** does the same in one transaction.
- **Validation**: opening qty > 0 (positive Decimal); opening unit cost >= 0 (zero
  allowed — sometimes things genuinely are free, e.g. gifted stock; warn but don't
  block on zero). Qty and unit cost are **required together or absent together** — never
  one without the other. One shared validator backs both the manual path (inputs
  `openingQty` + `openingUnitCost`) and the CSV path (columns `openingStock` +
  `openingUnitCost`) — no forked logic (ADR-001 discipline).
- **Owner-only on the repair tool** (path #4), same gating as recalculate-cost and CSV
  import. The create-time opening (paths #2 and #3) is owner-only by virtue of being
  in the existing create flow which is already owner-gated.
- **No money side-effects.** No Supplier, no SupplierPayment, no Customer, no cash
  drawer impact (this is the test that proves opening is correctly NOT a Purchase).
  An explicit acceptance test confirms.
- **costAtTime snapshot rule still holds.** A sale after an opening declaration
  snapshots the post-opening avgCost. The opening movement participates in setting
  avgCost at the moment of opening, and from then on the sale rule is unchanged. No
  special-casing in saleService — it reads Item.avgCost at sale time, period.

## 7. Validation rules
- `StockMovement.type = 'opening'`: qty > 0 (positive Decimal128); `costAtTime` >= 0;
  date present (defaults to today); createdBy required; note optional except in the
  repair tool where note is REQUIRED (owner must explain the repair).
- Manual create's opening fields: `openingQty` and `openingUnitCost` both required if
  either is set; both must validate per above; rejected with clear inline errors if
  partial.
- CSV row: same pairing rule on the `openingStock` + `openingUnitCost` columns —
  row-level error in preview if only one is filled on a given row. Shared validator with
  the manual path — no forked logic (ADR-001 discipline).
- Repair tool: itemId must exist; unitCost >= 0; qty > 0; note required, max length
  same as other notes; date optional (computed to "just before earliest existing
  movement" if not supplied or if too late to make sense).

## 8. Acceptance criteria (checklist)
- [ ] StockMovement.type enum accepts 'opening'; existing types still work.
- [ ] Creating an item with opening fields filled: item gets correct stockQty + avgCost
      immediately, an `opening` StockMovement exists with the right shape, no Purchase,
      no Supplier touched.
- [ ] Creating an item without opening fields: same as before this spec — item enters
      at qty 0 / avgCost 0, no movement written.
- [ ] CSV import with both opening columns: items land with correct stockQty + avgCost,
      one `opening` movement per row, no Purchase, no Supplier.
- [ ] CSV import with only `openingStock` (no cost) or only `openingUnitCost` (no qty):
      row-level error in preview, same UX shape as other invalid fields. (This is the
      BREAKING contract change — `openingStock` alone was previously legal.)
- [ ] CSV import with neither opening column: items land at qty 0 / avgCost 0
      (regression — existing import unaffected).
- [ ] Repair tool on an item with no existing opening: creates one with createdAt
      properly ordered before all existing movements, replay recomputes correctly,
      drift report returned.
- [ ] Repair tool on an item that already has an opening: deletes the old, creates
      the new in the same transaction, ends with exactly one opening movement.
- [ ] Repair tool rejects if note is empty.
- [ ] **Headline regression: opening + purchase + reverse-purchase composes correctly.**
      Declare opening 15 @ Rs 200, purchase 5 @ Rs 300, reverse the purchase. After
      replay, avgCost = Rs 200 exactly, stockQty = 15.
- [ ] **Headline regression: the "cost = 0 then purchase" bug is fixed via repair.**
      Set up the failure case (item entered at qty 15 cost 0, then purchase 15 @ Rs
      250). Confirm avgCost is currently the wrong Rs 125 (sanity check). Run repair
      with unitCost = Rs 250 (the real cost). Confirm avgCost is now Rs 250, drift
      report shows the correction.
- [ ] **Replay engine treats opening identically to purchase for cost.** Test: an
      item with ONLY an opening movement (no purchases ever) has avgCost = the
      opening's `costAtTime`, exactly.
- [ ] **Plain opening + purchase weighted-average (the basic composition).** Opening
      15 @ Rs 200 + purchase 5 @ Rs 300 → avgCost = Rs 225 ((15×200 + 5×300)/20),
      stockQty = 20. Proves opening averages WITH a purchase, not just alongside a reversal.
- [ ] **Opening + sale + return stays qty-only after the opening.** Opening 15 @ Rs 200,
      sell 5, return 2: avgCost remains Rs 200 throughout (sale/return never move cost),
      stockQty = 12. Proves opening doesn't perturb the qty-only movement handling.
- [ ] **Headline regression: legacy-adjustment repair (the critical catch).** Set the
      item up the way TODAY's `createItem` does — a `type:'adjustment'` movement noted
      `"opening stock"` for +15 (cost-less) AND item.stockQty 15 — then a purchase
      +15 @ Rs 250 (so current avgCost is the wrong Rs 125). Run repair with
      openingUnitCost = Rs 250, qty = 15. After repair: **stockQty = 30 (NOT 45)**,
      avgCost = Rs 250 (opening 15@250 + purchase 15@250 average to 250), the legacy
      adjustment is **deleted**, and **exactly one** `type:'opening'` movement exists.
- [ ] **Repair idempotency.** Running the repair twice with the same inputs yields the
      same final state — no second opening movement, no drift, no compounding stock.
- [ ] **At most one opening movement per item, ever.** Invariant test: try to manually
      insert a second opening movement → rejected.
- [ ] An item with an opening, followed by sales, snapshots costAtTime correctly on
      each sale (the opening's `costAtTime` flows through as the per-line cost, profit
      computes correctly).
- [ ] No supplier balance is touched by any opening flow (an explicit assertion in
      tests).
- [ ] No cash drawer / daily-close line item moves because of an opening (an explicit
      assertion: Daily Close for the date of an opening shows no expense, no drawer
      adjustment, no supplier payment, no purchase total contribution).
- [ ] Recalculate-cost on an item with an opening (and possibly purchases/reversals)
      reports zero drift after a clean replay.
- [ ] Owner-only gating on the repair tool endpoint and UI.
- [ ] CSV preview displays the `openingStock` and `openingUnitCost` columns in the
      existing preview table; errors render inline.

## 9. Decisions (resolved in review)
1. **Manual create UI** → inline section in the Add Item modal, **collapsed by default**
   behind a "+ Declare opening stock" link. Keeps the everyday add flow uncluttered. ✅
2. **Repair tool placement** → **inside Edit Item**, a red-tinted owner-only section,
   co-located with the existing recalculate-cost button. ✅
3. **CSV columns optional** → optional, with the **pairing rule enforced** (`openingStock`
   + `openingUnitCost` together or both absent). Required would force a cost on
   genuinely-free items. ✅
4. **Ordering** → the **`createdAt = min(remaining) − 1ms` trick**, no `postingOrder`
   column. Mongo `Date` is ms-resolution; a full-1ms subtraction is strictly distinct and
   sorts first by the primary key. (postingOrder hedge dropped.) ✅
5. **Show current opening in Edit Item** → **yes**, a read-only "Opening: 15 @ Rs 200 on
   …" line — and it must surface **both** `type:'opening'` AND legacy
   `type:'adjustment'`-noted-`"opening stock"` movements, so the items that most need
   repair visibly show their (broken) opening instead of appearing empty. ✅
6. **Post-ship repair walk** → **yes** — hand-walk a repair of any live-DB items with the
   cost=0-then-purchase pattern before the real 200-item import. This is exactly where
   the legacy-adjustment double-count (§10) would have bitten, so it validates the fix on
   real corruption. ✅

## 10. Notes / decisions
- **🔴 The single most important reason this spec needed careful review — the legacy
  adjustment double-count.** Today's `createItem` writes opening stock as a
  `type:'adjustment'` movement noted `"opening stock"` (cost-less) *and* sets stockQty.
  A repair tool that only replaced `type:'opening'` movements would stack a new opening
  on top of that legacy adjustment → replay double-counts stock (e.g. 15 → 45) while only
  appearing to fix avgCost. It would pass every headline test (which build the bug with
  the NEW shape) and silently corrupt real stock on the owner's first repair. Fix is
  twofold: (a) the repair transaction deletes the legacy `adjustment`-`"opening stock"`
  movement before creating the new opening (§4.4); (b) `createItem` stops emitting the
  legacy shape and emits `type:'opening'` going forward (§4.2). A dedicated headline
  regression (§8) sets the data up the way the OLD code actually did it.
- **ADR-013 to write alongside this spec:** "Opening stock is a first-class
  inventory-declaration concept, not a kind of purchase." Frame in the 009/010/011/012
  voice: the rule, the rationale (no supplier debt, no cash impact, immutable single-
  per-item, repair-only via delete+replace), and the extension point (if a future
  feature ever needs "batch openings with different costs per batch," it would be a
  new spec, not a tweak to this one). **Carve-out:** the persisted opening cost lives in
  `StockMovement.costAtTime`, the same field purchases use — there is no separate
  opening-cost field. The conceptual distinction (opening vs purchase) is the `type`
  enum value; cost *storage* is unified.
- **Build order:**
  1. costService + StockMovement enum (ISOLATED, PAUSE on green): add `opening` to the
     enum; extend the recompute trigger to a `COST_BEARING = {purchase, opening}` set;
     extend the null/negative-`costAtTime` guard to opening; update the costService
     doc-comment. Tests: opening-only → avgCost = costAtTime; opening + purchase
     weighted-average; opening + reverse-purchase; opening with null costAtTime rejected;
     existing purchase tests still pass. This is the load-bearing change — verify replay
     correctness in isolation before anything else.
  2. Manual create path: change `createItem` to emit `type:'opening'` (with costAtTime)
     when opening fields are provided (NOT the legacy adjustment) + Zod for the paired
     fields; item + opening movement in one transaction. Tests.
  3. CSV path: add the `openingUnitCost` column (reuse existing `openingStock` for qty)
     to HEADERS + normalizeRow + row-level pair validation. Tests including the "only one
     column filled" error and the regression that neither column = unchanged behavior.
  4. Repair service: ONE transaction — delete existing `opening` AND legacy
     `adjustment`-`"opening stock"` movements, create the new `opening`, run the PURE
     `recomputeItemCostByReplay(itemId, {session})` (NOT the recalculate-cost wrapper),
     persist. Tests including the headline legacy-adjustment regression + idempotency.
  5. Routes + HTTP smoke tests (opening on create, CSV, repair endpoint). PAUSE on green.
  6. Frontend: opening fields in Add Item modal (collapsed-by-default section), repair
     section in Edit Item modal (red-tinted, owner-only, with the read-only "current
     opening" display per §9.5 surfacing both shapes), CSV preview rendering for the new
     column.
  7. Browser verification end-to-end: create a new item with opening, run a sale,
     check profit is correct. Reproduce the legacy bug (cost=0 adjustment + a purchase),
     run repair, check stock AND avgCost are both correct.
- After ship: ADR-013 written, PROJECT_PLAN + CLAUDE.md updated to mark 006c shipped.
  Then a deliberate **owner-driven repair walk** of any items in the current live DB
  with the cost=0-then-purchase pattern, before the real 200-item CSV import. This
  closes the loop end-to-end.
- **After 006c, the next phase is genuinely Phase 7 (AI layer)** — no more polish
  slices unless real-shop usage surfaces another foundational gap.

  

  