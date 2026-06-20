# Spec: 001 — Inventory / Items (core catalogue)

- **Status:** in-progress (data model + transaction services built & tested; UI pending)
- **Phase:** Phase 1 — Inventory core
- **Author / date:** owner / 2026-06-20

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
- Item create / read / update / deactivate (soft delete via `isActive`). Reactivation allowed.
- Fields: sku, name, categoryId, baseUnit, retailPrice, wholesalePrice (optional), avgCost
  (read-only here — set by purchases later, default 0 for now), reorderLevel, stockQty, notes,
  isActive.
- Category create / list / deactivate (simple flat list for now; hierarchy can come later).
- Item list with **server-side pagination**, search (by name + sku) and filter by category +
  active/inactive.
- Manual **stock adjustment** action (e.g. after a physical count): records a StockMovement of
  type `adjustment` and updates stockQty — inside one transaction.
- A single store-level **Settings** document holding the `allowNegativeInventory` flag
  (default `true`). The flag must exist and be readable now; it is consumed later by the sales
  feature, not in this spec.

**Out of scope (explicitly not now):**
- Sales, purchases, suppliers, customers, ledgers, COGS calculation.
- The **Negative Stock view** — deferred to the sales spec, where negative stock first becomes
  reachable. (The `allowNegativeInventory` flag is created now; the view that surfaces negative
  items is built then.)
- CSV bulk import (next spec — important, but separate).
- Multiple sell-units per item (the `ItemUnit` sub-document) — design the field but don't
  build the UI yet.
- Barcodes / label printing.
- Auth/roles beyond what Phase 0 already set up.
- A full settings system / settings UI (only the one `allowNegativeInventory` flag matters now).

## 4. UI / flow
- **Items page:** search box + category filter + active/inactive toggle, then a paginated table
  (sku, name, category, stockQty, retailPrice, a low-stock indicator). "Add item" button
  top-right.
- **Add/Edit item form:** modal or separate page; all fields above; validation on submit;
  avgCost shown read-only. SKU is pre-filled with an auto-generated value (see §9.2) and is
  editable. On create, an opening stock quantity (≥ 0) may be entered.
- **Adjust stock:** small action on each row → enter new counted quantity (≥ 0) + a reason note
  → saves an adjustment movement and updates the count. Show the difference (e.g. "−3") for
  confirmation before saving.
- **Deactivate:** action on each row; confirms; item disappears from the default (active)
  view but stays in the database. A deactivated item can be reactivated.
- **Unhappy paths:** duplicate SKU rejected; non-positive retail price, negative wholesale
  price, or negative counted quantity rejected; empty required fields blocked with clear
  messages; deactivating a category that still has active items rejected with a clear message.

## 5. Data model changes
All Mongoose schemas use `timestamps: true`.

- **Category**
  - `name` — string, required, **unique (case-insensitive)**.
  - `skuPrefix` — string, 3–4 chars, uppercased; derived from `name` on create, editable. Used
    as the `<CAT>` portion of auto-generated SKUs (see §9.2). Stable: it does not change if the
    name later changes unless the owner edits it.
  - `isActive` — bool, default `true`.
  - (Room for `parentId` later for floor → section nesting; not added now.)

- **Item**
  - `sku` — string, required, **unique (case-insensitive)**, trimmed, no spaces.
  - `name` — string, required, 1–120 chars.
  - `categoryId` — ObjectId ref `Category`, required.
  - `baseUnit` — string enum (see §9.1). **Immutable once any StockMovement exists for the item.**
  - `retailPrice` — integer **paisa**, > 0.
  - `wholesalePrice` — integer **paisa**, ≥ 0, optional.
  - `avgCost` — **Decimal128** paisa, default `0`. Read-only in this spec (set by purchases later).
  - `reorderLevel` — integer ≥ 0, default `0`.
  - `stockQty` — **Decimal128**, default `0`, **cached**. **No `min` — may be negative** (driven
    negative only by future sales; see §6).
  - `notes` — string, optional.
  - `isActive` — bool, default `true`.
  - `units` — array, present in the schema for future `ItemUnit` sub-docs, **unused for now**.

- **StockMovement** (append-only audit trail)
  - `itemId` — ObjectId ref `Item`, required.
  - `qty` — **Decimal128**, signed (+in / −out), required, non-zero.
  - `type` — enum: `purchase | sale | return | adjustment`.
  - `refId` — ObjectId, optional. **Polymorphic** (purchase/sale/etc.) — not a single Mongoose
    `ref`, so it is not populated automatically.
  - `costAtTime` — **Decimal128** paisa, optional (unused in this spec).
  - `note` — string; **required when `type === 'adjustment'`**.
  - `createdBy` — ObjectId ref `User`, required (audit).

- **Settings** (singleton document)
  - `allowNegativeInventory` — bool, default `true`.

- **Counter** (supports atomic SKU numbering)
  - `_id` — string (the SKU prefix, e.g. `"WIR"`).
  - `seq` — integer. Incremented atomically (`findOneAndUpdate` with `$inc`, `upsert: true`)
    inside the item-create transaction.

## 6. Business rules (be precise — this is where bugs live)
- **Money handling:** `retailPrice` / `wholesalePrice` stored as integer **paisa**;
  `avgCost` / `costAtTime` stored as **Decimal128** paisa (weighted-average cost will produce
  fractional paisa later, so it must not be an integer). Convert to/from rupees **only at the
  UI boundary**. No floats anywhere.
- **Quantities:** `stockQty` and StockMovement `qty` are **Decimal128** (the shop sells wire,
  cable, and copper in fractional `gaz` / `meter` / `kg`). Transmit quantities over the API as
  **strings** to avoid float precision loss; parse to Decimal128 on the backend.
- **Stock effects:** `stockQty` on Item is a cached value. Any change to it MUST be paired with
  a StockMovement record, and both writes happen in a single MongoDB transaction
  (`session.withTransaction`) — never update `stockQty` alone.
- **Opening stock:** when a new item is created with an initial `stockQty > 0`, the create
  operation writes an opening StockMovement (`type: 'adjustment'`, `note: 'opening stock'`,
  `qty` = the opening quantity) **inside the same create transaction**. Creating with `0`
  writes no movement.
- **Manual adjustment semantics:** the entered **counted quantity is authoritative** (absolute
  set, not a delta typed by the user). Inside the transaction, the movement `qty` is computed
  as `countedQty − currentStockQty` read within that transaction, then `stockQty` is set to
  `countedQty`. If the computed delta is `0`, no movement is written and the count is reported
  as unchanged. (Computing the delta in-transaction avoids corruption from a concurrent edit.)
- **Negative stock (store policy):** `stockQty` may be negative at the data level. The
  `allowNegativeInventory` setting (single Settings doc, **default `true`**) governs whether
  future sales may drive stock below zero; negative stock must **never block a transaction** and
  must **never be shown at point of sale**. In this spec there is no path that produces negative
  stock (adjustment input is validated ≥ 0), but the model permits it so the sales feature can
  rely on it. The owner-facing **Negative Stock view** is built in the sales spec.
- **COGS / valuation:** not touched in this spec (no sales/purchases yet). `avgCost` stays at
  its stored value; default `0`.
- **Categories:** a category **cannot be deactivated while any active item references it**
  (reject with a clear message). Items in scope must reference an **active** category.
- **Soft delete:** deactivating an item or category never deletes it or its StockMovements.
  Both can be reactivated. A SKU belonging to a deactivated item is **not** reusable for a new
  item (uniqueness is global across active and inactive).
- **Audit:** every StockMovement records `createdBy` (the authenticated user).

## 7. Validation rules
- `sku`: required, string, trimmed, **no spaces**, alphanumeric + `-`, **unique
  (case-insensitive)**. Auto-generated by default (§9.2); editable; a manual value that collides
  (case-insensitively) with an existing SKU is rejected.
- `name`: required, string, 1–120 chars.
- `categoryId`: required, must reference an **existing active** category.
- `baseUnit`: required, from the allowed enum in §9.1. Rejected if changed once a StockMovement
  exists for the item.
- `retailPrice`: required, integer paisa, **> 0**.
- `wholesalePrice`: optional, integer paisa, ≥ 0. **No** `wholesale ≤ retail` constraint.
- `reorderLevel`: integer ≥ 0, default 0.
- `stockQty` (opening, on create): decimal ≥ 0. (Model itself allows negatives; the **input**
  is constrained ≥ 0.)
- Adjustment **counted quantity**: decimal ≥ 0. Adjustment **reason note**: required.
- Quantities are validated as finite decimal strings and parsed to Decimal128. A value that is
  not a valid decimal (e.g. `""`, `"abc"`, `"1.2.3"`, `"NaN"`, `"1e3"`) is **rejected with a
  clear error — never coerced to `0` or `NaN`** before becoming a Decimal128.
- The same Zod schema shape (in `shared/`) validates the API request body and the React form.
  Prices are validated as **integer paisa** on both sides; the rupee↔paisa conversion is a
  frontend boundary transform, not part of the shared schema.

## 8. Acceptance criteria (checklist)
- [ ] Can create, edit, deactivate, and reactivate an item through the UI.
- [ ] Can create, list, and deactivate categories; deactivating a category with active items is
      rejected.
- [ ] SKU is auto-generated as `<CAT>-<NNNN>`, editable, and uniqueness is enforced
      case-insensitively; the counter is atomic (no duplicate SKUs under rapid creates).
- [ ] Search by name and SKU is case-insensitive substring; category + active filters work;
      the list is server-side paginated.
- [ ] Low-stock indicator shows when `reorderLevel > 0` **and** `stockQty ≤ reorderLevel`.
- [ ] Creating an item with opening stock writes an opening `adjustment` movement in the same
      transaction; creating with 0 writes none.
- [ ] Manual stock adjustment sets `stockQty` to the counted value AND writes a StockMovement
      (delta computed in-transaction), both in one transaction; the two never drift; a zero
      delta writes no movement.
- [ ] `baseUnit` cannot be changed once a StockMovement exists for the item.
- [ ] Duplicate SKU (case-insensitive), non-positive retail price, negative wholesale price,
      negative counted quantity, and empty required fields are all rejected with clear messages.
- [ ] All money handled as integer paisa (retail/wholesale) or Decimal128 paisa (avgCost); all
      quantities Decimal128; no floats.
- [ ] Every StockMovement records `createdBy`.
- [ ] Works fully through the UI with no AI.
- [ ] Tests cover: the create/opening-stock transaction, the adjustment transaction (stock +
      movement together, including zero-delta and concurrent-edit cases), and the
      money/validation rules. Test DB runs as a replica set so transactions work (see §11).

## 9. Decisions from the owner (answered)

### 9.1 Base units
Units are physical measures the shop sells by. Confirmed allowed-list (enum) for launch:
- `gaz` (yard — for wire and cable)
- `meter`
- `kg`
- `piece`
- `dozen`
- `coil`
- `set`

Stored as a fixed enum for now. New units can be added later; not a free-text field, to keep
data clean. Quantities are decimal (Decimal128), so fractional `gaz` / `meter` / `kg` are
supported.

### 9.2 SKU — hybrid (auto-generated, owner-editable)
- On new item, the system **auto-generates a SKU** of the form **`<CAT>-<NNNN>`**:
  - `<CAT>` — the category's `skuPrefix` (3–4 letters, uppercased; derived from the category
    name on creation, editable).
  - `<NNNN>` — a zero-padded, **atomically incremented** counter, kept per-prefix in the
    `Counter` collection (`findOneAndUpdate` + `$inc`, `upsert`), incremented inside the
    item-create transaction so concurrent creates can't collide. Example: `WIR-0007`.
  - If two categories happen to derive the same prefix, they share that prefix's counter — SKUs
    stay unique; that is acceptable.
- The SKU field is **editable** — the owner can overwrite the auto value with their own code.
- Whatever the final value, it must pass §7 validation (trimmed, no spaces, case-insensitively
  unique). A manual SKU that collides with an existing one is rejected.
- The SKU **does not auto-change** if the item's category later changes.

### 9.3 Negative stock — allowed by default, owner-monitored (rule lives in §6/§7)
- **Setting "Allow Negative Inventory" defaults to ON**, stored in the single store-level
  **Settings** document.
- Created and readable in this spec; **consumed by the sales feature later**, not here.
- The behavioural rule (never block, never shown at POS, surfaced later in a Negative Stock
  view) is stated once in **§6** and the model/validation split is in **§5/§7**. The
  owner-facing Negative Stock view is built in the sales spec.

### 9.4 Categories — flat for launch, sub-categories later
- Build a **flat category list** for the initial launch (matches current scope).
- **Sub-categories** (floor → section → category nesting) are a planned later feature, not
  built now. The schema leaves room (a category can gain a `parentId` later without breaking
  existing data).

## 10. Notes / decisions
- `units` array is in the schema now but intentionally unbuilt, so adding multi-unit selling
  later won't require a migration. Record in DECISIONS.md if that approach is confirmed.
- Money/precision split (integer paisa for prices, Decimal128 for avgCost and quantities) and
  the single-node-replica-set requirement for transactions are real architectural choices —
  record both in DECISIONS.md when building.

## 11. Environment / infrastructure note
- MongoDB multi-document transactions (`session.withTransaction`) require a **replica set**.
  - **Local dev:** run MongoDB as a single-node replica set (`mongod --replSet rs0`, then a
    one-time `rs.initiate()`). Document the exact steps in `backend/README.md`.
  - **Production:** MongoDB Atlas (always a replica set).
  - **Tests:** the test DB must also be a replica set, or every transaction-based test fails.
