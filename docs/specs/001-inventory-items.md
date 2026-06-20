# Spec: 001 — Inventory / Items (core catalogue)

- **Status:** draft
- **Phase:** Phase 1 — Inventory core
- **Author / date:** <you> / <fill in>

## 1. Problem / goal
The shop has thousands of items across three floors with no central record. We need a
catalogue: the ability to create, find, view, edit, and deactivate items, see current stock,
and manually adjust stock — the foundation every other feature (sales, purchases, reports)
depends on. **No sales or purchase logic in this spec** — just the items themselves and manual
stock adjustments.

## 2. User stories
- As the owner, I want to add a new item with its name, category, unit, prices, and reorder
  level, so the shop's stock is recorded in one place.
- As the owner, I want to search items by name or SKU quickly, so I can find one among
  thousands without scrolling.
- As the owner, I want to edit an item's details and manually correct its stock count, so the
  record matches reality after a physical count.
- As the owner, I want to deactivate an item I no longer stock (not delete it), so old records
  and reports stay intact.

## 3. Scope
**In scope:**
- Item create / read / update / deactivate (soft delete via `isActive`).
- Fields: sku, name, categoryId, baseUnit, retailPrice, wholesalePrice (optional), avgCost
  (read-only here — set by purchases later, default 0 for now), reorderLevel, stockQty, notes,
  isActive.
- Category create / list (simple flat list for now; hierarchy can come later).
- Item list with search (by name + sku) and filter by category + active/inactive.
- Manual **stock adjustment** action (e.g. after a physical count): records a StockMovement of
  type `adjustment` and updates stockQty — inside one transaction.

**Out of scope (explicitly not now):**
- Sales, purchases, suppliers, customers, ledgers, COGS calculation.
- CSV bulk import (next spec — important, but separate).
- Multiple sell-units per item (the `ItemUnit` sub-document) — design the field but don't
  build the UI yet.
- Barcodes / label printing.
- Auth/roles beyond what Phase 0 already set up.

## 4. UI / flow
- **Items page:** search box + category filter + active/inactive toggle, then a table
  (sku, name, category, stockQty, retailPrice, a low-stock indicator when stockQty ≤
  reorderLevel). "Add item" button top-right.
- **Add/Edit item form:** modal or separate page; all fields above; validation on submit;
  avgCost shown read-only.
- **Adjust stock:** small action on each row → enter new counted quantity + a reason note →
  saves an adjustment movement and updates the count. Show the difference (e.g. "−3") for
  confirmation before saving.
- **Deactivate:** action on each row; confirms; item disappears from the default (active)
  view but stays in the database.
- **Unhappy paths:** duplicate SKU rejected; negative prices/quantities rejected; empty
  required fields blocked with clear messages.

## 5. Data model changes
New Mongoose collections:
- **Category** — name (required, unique), isActive, timestamps.
- **Item** — sku (required, unique), name (required), categoryId (ref Category), baseUnit
  (string, e.g. "piece", "meter"), retailPrice (paisa, int ≥ 0), wholesalePrice (paisa, int ≥
  0, optional), avgCost (paisa, int ≥ 0, default 0), reorderLevel (int ≥ 0, default 0),
  stockQty (int, default 0), notes (string, optional), isActive (bool, default true),
  timestamps. Include the `units` array field in the schema (for future ItemUnit sub-docs) but
  leave it unused for now.
- **StockMovement** — itemId (ref Item), qty (int, +/−), type (enum: purchase|sale|return|
  adjustment), refId (optional), costAtTime (paisa, optional), note (string, optional),
  timestamps.

## 6. Business rules (be precise — this is where bugs live)
- **Money handling:** all prices stored as integer **paisa**; convert to/from rupees only at
  the UI boundary. No floats anywhere.
- **Stock effects:** `stockQty` on Item is a cached value. Any change to it MUST be paired with
  a StockMovement record, and both writes happen in a single MongoDB transaction
  (`session.withTransaction`) — never update stockQty alone.
- **COGS / valuation:** not touched in this spec (no sales/purchases yet). avgCost stays at its
  stored value; default 0.
- **Edge cases:** adjustment that would make stock negative → reject with a clear message
  unless the owner explicitly confirms (decide with owner); duplicate SKU → reject;
  deactivating an item never deletes it or its movements.

## 7. Validation rules
- sku: required, string, unique, trimmed, no spaces.
- name: required, string, 1–120 chars.
- categoryId: required, must reference an existing active category.
- baseUnit: required, from an allowed list (piece, meter, coil, dozen, kg, set — confirm list
  with owner).
- retailPrice: required, integer paisa ≥ 0.
- wholesalePrice: optional, integer paisa ≥ 0.
- reorderLevel, stockQty: integer ≥ 0.
- Adjustment reason note: required when adjusting stock.
- Same Zod schema shape used on both frontend form and backend route.

## 8. Acceptance criteria (checklist)
- [ ] Can create, edit, and deactivate an item through the UI.
- [ ] Can create and list categories.
- [ ] Search by name and SKU returns correct results; category + active filters work.
- [ ] Low-stock indicator shows when stockQty ≤ reorderLevel.
- [ ] Manual stock adjustment updates stockQty AND writes a StockMovement, both in one
      transaction; the two never drift.
- [ ] Duplicate SKU, negative price/qty, and empty required fields are all rejected with clear
      messages.
- [ ] All money handled as integer paisa; no floats.
- [ ] Works fully through the UI with no AI.
- [ ] Tests cover: the adjustment transaction (stock + movement together), and the
      money/validation rules.

## 9. Open questions for the owner
- What's the full list of base units the shop actually uses?
- Do you want your own SKU scheme (and a format), or auto-generated SKUs?
- Should a stock adjustment ever be allowed to go negative (e.g. data-entry catch-up)?
- Flat categories enough for now, or do you need floor → section → category nesting from day
  one?

## 10. Notes / decisions
- `units` array is in the schema now but intentionally unbuilt, so adding multi-unit selling
  later won't require a migration. Record in DECISIONS.md if that approach is confirmed.