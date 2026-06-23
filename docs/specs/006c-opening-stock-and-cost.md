# Spec: 006c — Opening stock & unit cost (the real-world "I already have inventory" gap)

- **Status:** draft (pending review)
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
     (positive Decimal128), `unitCost` (Decimal128 — the per-unit cost being declared),
     `date` (user-supplied, default today), `note` (optional), `createdBy`, `createdAt`
     (server-set, the posting-order anchor).
   - **Treated as a purchase-type event** by costService's replay (the only behavioral
     change to the engine — see §6).

2. **Manual single-item path: opening fields on Add/Edit Item modal.**
   - When CREATING an item: optional "Opening stock" section with `qty` and `unitCost`
     inputs. If filled, the create transaction also writes one `opening` StockMovement
     and sets the item's stockQty + avgCost in that same transaction.
   - When EDITING an item: the "Opening stock" section is replaced by a separate
     **"Repair opening cost"** action (owner-only, behind a confirmation), described in
     §4 path #3 — editing is NOT a casual operation.
   - This means the create form has BOTH paths: the existing fields (no opening, item
     enters at qty 0 / avgCost 0 — current behavior, still valid) AND the new opening
     fields (declare what you have).

3. **CSV import: two new optional columns `openingQty` and `openingUnitCost`.**
   - If both empty → item created with stockQty 0, avgCost 0 (current behavior).
   - If both present → item created AND an `opening` StockMovement written, all in the
     same per-row transaction (the existing CSV importer is already per-row
     transactional — no architecture change, just an addition to the row's work).
   - If only one is present → row-level validation error ("openingQty and
     openingUnitCost must be set together"), surfaced in the existing preview UI.
   - `openingUnitCost` is rupees-decimal at the boundary (matches existing CSV money
     handling — converted via shared validator).
   - The owner's real-world ~200-item import IS the primary motivator for this path.

4. **Repair tool: owner-only "Set opening cost" for items already in the system.**
   - Visible only to owner, in the Item detail/edit screen as a separate red-tinted
     section: "This item's avgCost looks wrong? Declare its correct opening cost."
   - Inputs: `unitCost` (the corrected per-unit cost), `qty` (defaults to the item's
     current stockQty, editable in case it's also wrong), `date` (defaults to the
     earliest existing StockMovement.createdAt for this item, so the opening slots in
     as the FIRST event in the item's history), `note` (required for repairs — owner
     must explain why).
   - Behavior: if an `opening` movement already exists for this item, **replace it**
     (delete + create new with the same posting-order anchor). If not, create one with
     a `createdAt` set to just before the earliest existing movement (so the engine
     sees it as the first event). Then trigger a `recomputeItemCostByReplay` and return
     the drift report to the owner, same shape as the existing recalculate-cost tool.
   - This is the cleanup path for the owner's already-broken test data, AND for any
     future "oops I entered cost = 0" mistakes. It's the only path in the entire
     codebase that mutates an existing StockMovement, and it does so by delete+recreate,
     not in-place edit.

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
- **StockMovement** for an `opening` row: `unitCost` is now meaningful (existing
  `purchase` rows already have it; existing `sale`/`return`/`adjustment`/`reversal` rows
  don't use it). No new fields needed — the existing shape covers it.
- **No new collection.** Opening is just another type of StockMovement.
- **Item** unchanged. avgCost and stockQty are computed/updated as before; just one
  more movement type can move them.
- **No indexes new.** Existing index on (itemId, createdAt) (assumed; verify in review)
  is what replay walks; opening movements use the same one.

## 6. Business rules
- **Opening is a purchase-type event for costService replay.** The only logic change to
  costService is: the set of types that trigger weighted-average recomputation grows
  from `{purchase}` to `{purchase, opening}`. The math is identical (effectiveOld =
  max(oldQty, 0) on both sides, scale + round-half-even per ADR-001). Verify against
  the actual costService code in review: the recompute trigger should be a single
  set/array, easy to extend by one value. If it's a switch or if/else, that's a small
  refactor in this spec, not a hidden risk.
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
  - If existing movements: createdAt = `min(existingMovements.createdAt) - 1ms`. Safe
    because Mongo ObjectIds are monotonic at sub-millisecond resolution and the tiebreak
    rule handles the rest. Verify no other movement could have been created in that 1ms
    window for the same item (extremely unlikely in single-shop usage, impossible if
    the repair is happening while the shop is closed).
- **Repair tool always replaces** any existing `opening` movement for the same item
  (delete old + create new in one transaction). There can only ever be **one opening
  movement per item**, by construction. The replay engine should not need to handle
  multiple openings — confirm by adding a uniqueness constraint:
  `StockMovement.find({ itemId, type: 'opening' }).countDocuments() <= 1` invariant,
  enforced in the repair service and asserted in tests.
- **CSV path with openingQty + openingUnitCost** writes the opening movement in the
  same per-row transaction as the Item create. Failure of either side rolls back both.
- **Manual create with opening fields** does the same in one transaction.
- **Validation**: `openingQty > 0` (positive Decimal), `openingUnitCost >= 0` (zero
  allowed — sometimes things genuinely are free, e.g. gifted stock; warn but don't
  block on zero). `openingQty` and `openingUnitCost` are required together or absent
  together — never one without the other. Shared validator with CSV path.
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
- `StockMovement.type = 'opening'`: qty > 0 (positive Decimal128); unitCost >= 0; date
  present (defaults to today); createdBy required; note optional except in the repair
  tool where note is REQUIRED (owner must explain the repair).
- Manual create's opening fields: openingQty and openingUnitCost both required if
  either is set; both must validate per above; rejected with clear inline errors if
  partial.
- CSV row: same pairing rule; row-level error in preview if only one column is filled
  on a given row. Shared validator with manual path — no forked logic (ADR-001
  discipline).
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
- [ ] CSV import with only `openingQty` (no cost) or only `openingUnitCost` (no qty):
      row-level error in preview, same UX shape as other invalid fields.
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
      opening's unitCost, exactly.
- [ ] **At most one opening movement per item, ever.** Invariant test: try to manually
      insert a second opening movement → rejected.
- [ ] An item with an opening, followed by sales, snapshots costAtTime correctly on
      each sale (the opening's unitCost flows through as the per-line cost, profit
      computes correctly).
- [ ] No supplier balance is touched by any opening flow (an explicit assertion in
      tests).
- [ ] No cash drawer / daily-close line item moves because of an opening (an explicit
      assertion: Daily Close for the date of an opening shows no expense, no drawer
      adjustment, no supplier payment, no purchase total contribution).
- [ ] Recalculate-cost on an item with an opening (and possibly purchases/reversals)
      reports zero drift after a clean replay.
- [ ] Owner-only gating on the repair tool endpoint and UI.
- [ ] CSV preview displays the openingQty and openingUnitCost columns in the existing
      preview table; errors render inline.

## 9. Open questions (resolve in review)
1. **Manual create UI placement of the opening fields.** Inline section in the existing
   Add Item modal, or a separate "Add with opening stock" toggle button? Leaning:
   inline section, collapsed by default with a "+ Declare opening stock" link to
   expand. Keeps the simple "add new item" flow uncluttered for everyday use while
   making the opening path one click away.
2. **Repair tool placement.** Inside the Edit Item modal as a red-tinted section, or
   as a separate "Repair item cost" page accessible from the owner-only section of
   inventory? Leaning: inside Edit Item, like the existing recalculate-cost button —
   keeps repair operations co-located with the item they affect.
3. **Should the CSV columns be REQUIRED or remain optional?** Spec says optional
   (matches current per-field tolerance in the CSV importer). Confirm — required would
   force the owner to know cost for every item including genuinely-free ones, which
   would be wrong.
4. **The "createdAt = earliest - 1ms" trick** for slotting an opening before existing
   movements. Verify with Claude Code against the actual replay code: is `createdAt`
   asc + `_id` asc tiebreak truly stable enough at sub-ms? If not, the alternative is
   an explicit `postingOrder` integer column on StockMovement (bigger change). Leaning:
   the 1ms trick is fine; if review finds a concern, fall back to an explicit ordering
   field.
5. **Should an item's edit form show its current opening (if any)?** Read-only
   "Opening: 15 @ Rs 200 on 2026-01-12" line in the Edit Item modal as context, so the
   owner can see what's there before repairing? Leaning: yes, useful and trivial.
6. **Reverse engineering the existing test data.** The owner has some items in the
   live DB with corrupt avgCost from the cost=0-then-purchase pattern. Recommend the
   first thing post-ship: a hand-walked repair of those items using the new tool,
   to validate the repair path end-to-end on real corruption. Confirm.

## 10. Notes / decisions
- **ADR-013 to write alongside this spec:** "Opening stock is a first-class
  inventory-declaration concept, not a kind of purchase." Frame in the 009/010/011/012
  voice: the rule, the rationale (no supplier debt, no cash impact, immutable single-
  per-item, repair-only via delete+replace), and the extension point (if a future
  feature ever needs "batch openings with different costs per batch," it would be a
  new spec, not a tweak to this one).
- **Build order:**
  1. costService: extend the purchase-type-events set to include 'opening' (one-line
     change), with a regression test that an item with only an opening has avgCost =
     unitCost. PAUSE on green — this is the load-bearing change, verify replay
     correctness in isolation before anything else.
  2. StockMovement schema enum update + tests for the new type.
  3. Manual create path: extend createItem service + Zod to accept opening fields,
     write the item + opening movement in one transaction. Tests.
  4. CSV path: add openingQty + openingUnitCost columns to HEADERS + normalizeRow +
     row-level pair validation. Tests including the "only one column filled" error.
  5. Repair service: the delete-old + create-new + replay flow. Tests including the
     headline regression (cost=0-then-purchase fix).
  6. Routes + HTTP smoke tests. PAUSE on green.
  7. Frontend: opening fields in Add Item modal (collapsed-by-default section), repair
     section in Edit Item modal (red-tinted, owner-only, with the read-only "current
     opening" display per §9.5), CSV preview rendering for the new columns.
  8. Browser verification end-to-end: create a new item with opening, run a sale,
     check profit is correct. Create an item with cost=0 + a purchase, deliberately
     reproduce the bug, run repair, check it's fixed.
- After ship: ADR-013 written, PROJECT_PLAN + CLAUDE.md updated to mark 006c shipped.
  Then a deliberate **owner-driven repair walk** of any items in the current live DB
  with the cost=0-then-purchase pattern, before the real 200-item CSV import. This
  closes the loop end-to-end.
- **After 006c, the next phase is genuinely Phase 7 (AI layer)** — no more polish
  slices unless real-shop usage surfaces another foundational gap.