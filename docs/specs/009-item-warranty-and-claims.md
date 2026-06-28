# Spec: 009 — Item warranty terms + claim checking

> Slice 3 of the June-2026 feature batch. Spec-first because it changes what is
> recorded on an immutable `Sale` line (ADR-007).

- **Status:** done (shipped 2026-06-28) — ADR-017
- **Phase:** post-Phase-6 enhancement (correctness foundation complete)
- **Author / date:** Claude Code / 2026-06-27

## 1. Problem / goal

Items carry manufacturer warranties — often **several per item** ("motor: 10 years",
"fan kit: 1 year"). Today nothing records these, and a sale captures nothing about
them. When a customer comes back with a faulty unit, the owner has no way to check
whether *that item, bought on that date* is still under warranty. Goal: record
warranty terms on an item, **snapshot them onto the sale** at sale time, and let the
owner check a claim against the original sale date.

## 2. User stories

- As the owner, I want to record one or more warranty terms on an item (a label +
  how long), so the info lives with the product.
- As the owner, when a customer brings back a faulty item, I want to open their
  original sale and immediately see, per component, **whether the warranty is still
  valid** as of today (or a date I pick), so I can honour or decline the claim.
- As the owner, I want a past sale's warranty to reflect what it was **when sold** —
  even if I later edit the item's warranty terms.

## 3. Scope

**In scope:**
- A `warranties[]` list on `Item` (label + duration value + unit), editable on the
  Item form.
- Snapshotting those terms onto each **item-kind** `Sale.lines[]` entry at sale time.
- A warranty section on **Sale Detail**: per item line, each term with a computed
  **Valid until <date> / Expired on <date>** status against a claim date (default
  today).
- A pure, tested expiry helper (years/months/days, calendar-correct).

**Out of scope (explicitly not now):**
- Serial-number / IMEI tracking. Claims are checked against a *known sale* (found via
  the existing Sale History / customer khata), not a global serial lookup.
- A standalone "search all sales by item for warranty" screen.
- Warranty on **quick lines** (uncatalogued, no item — ADR-016). Absent, like cost.
- Warranties in the CSV import template (locked headers, ADR-004).
- Recording the claim itself (an RMA/claim log), supplier-side warranty, or any
  automated workflow. v1 only *answers the question*.

## 4. UI / flow

**Item form (`ItemForm.jsx`):** a "Warranty terms" section — a small repeatable row
list. Each row: a **label** text input ("motor", "fan kit"; optional), a **duration
value** number, and a **unit** select (years / months / days). "+ Add term" appends a
row; each row has a remove (×). Empty list is fine (most items have none). Persists on
save like any other item field.

**Selling (POS):** no new step. The warranty terms ride along automatically —
snapshotted server-side, exactly like `costAtTime`. (Optional, surfaced read-only on
the line later; not required for v1.)

**Claim check (`SaleDetail.jsx`):** a "Warranty" block. A single **claim-date**
input defaults to today. For each item line that carries snapshotted terms, render
**one row per term** (never collapsed): `<label> — <value> <unit>` → a **status
badge**:
- green **"Valid until DD-MM-YYYY"** when claimDate ≤ expiry,
- gray **"Expired on DD-MM-YYYY"** when claimDate > expiry.

So a fan sold with motor (10y) + fan kit (1y), checked 2 years later, renders as **two
separate rows** — "motor — Valid until …" (green) and "fan kit — Expired on …" (gray)
— so the owner sees exactly which component is still covered. Item lines with no
snapshotted terms show "No warranty on record". Quick lines show nothing. Changing the
claim date re-computes all badges live (pure client calc, no refetch).

**Unhappy paths:** value ≤ 0 / non-integer / missing unit → field error on the Item
form. A sale line from before this feature (no `warranties`) → "No warranty on record"
(backward compatible, never an error).

## 5. Data model changes

**Warranty is per-component: one item can hold MANY named terms with different
durations** — e.g. a pedestal fan = `[{label:"motor", 10, years}, {label:"fan kit",
1, year→years}]`. This is a list, not a single field, precisely because the motor and
the fan kit expire on different dates from the same purchase.

A reusable sub-schema `warrantyTermSchema` `{ label, durationValue, durationUnit }`:
- `label`: String, trimmed, optional (≤ 60 chars) — the component name ("motor",
  "fan kit"). Blank renders as "Warranty".
- `durationValue`: Number, integer ≥ 1.
- `durationUnit`: enum `["years","months","days"]`.

So "motor: 10 years, fan kit: 1 year" is stored as two entries in `warranties[]`, each
independent end to end (own expiry, own badge — never merged into one).

**`Item`** gains `warranties: [warrantyTermSchema]`, default `[]`. Mutable item
metadata (like `notes`/prices) — editing is allowed and only affects **future** sales.

**`Sale.lines[]`** gains `warranties: [warrantyTermSchema]` on **item-kind lines
only** — a snapshot copied from the item at sale time. Absent on quick lines (like
`costAtTime`/`itemId`). Immutable once written (ADR-007).

**No new collection. No migration.** Existing items default to `[]`; existing sale
lines have no `warranties` → treated as "none on record". Claim validity is **derived
on read** (ADR-011) — no stored expiry date.

## 6. Business rules (be precise — this is where bugs live)

- **Money / stock / COGS:** none. Warranty is metadata; it adds **no** money, stock,
  or cost effect. It rides *inside* the existing `recordSale` transaction only because
  it's written as part of the same line — no new write, no new transaction.
- **Snapshot (the core rule):** in `recordSale`, when building an item storedLine,
  copy `item.warranties` (read in-txn, same place `costAtTime` is snapshotted) onto
  the line, normalized to the sub-schema shape. **Never** re-derive a past sale's
  warranty from the live item — the item's terms are mutable; the sale's are frozen.
  This is the `costAtTime` precedent (ADR-007) applied to warranty.
- **Warranty clock = `Sale.date`** (the receipt date), NOT `createdAt` (see §9.1).
  Every expiry below is measured from `Sale.date`.
- **Expiry computation (pure, tested):** `expiry(Sale.date, term)` = calendar-add the
  duration to `Sale.date`:
  - `years`: add `value` to the year; `months`: add `value` months; `days`: add
    `value` days.
  - **End-of-month clamp:** adding years/months to e.g. Jan-31 or a Feb-29 sale lands
    on the last valid day of the target month (Feb-28/29), never rolls into the next
    month. (Native `Date` rolls over; the helper must clamp.)
- **Validity:** `valid = claimDate ≤ expiry`, compared at **day granularity** in
  Asia/Karachi (the fixed +5 offset, ADR-010) so there's no off-by-one from clock
  time. The expiry day itself is **inclusive** (valid through end of that day).
- **Edge cases:** empty `warranties` → no rows (not an error). A line with multiple
  terms → each term independent (a 10-yr motor can be valid while a 1-yr fan kit has
  expired on the same sale). Future-dated `Sale.date` → expiry simply also in the
  future (allowed; surfaced honestly).

## 7. Validation rules

Shared Zod `warrantyTermSchema` (used by item create + update; backend re-validates):
- `label`: string, trimmed, optional, max 60.
- `durationValue`: integer ≥ 1 (reject 0, negatives, non-integers, > 100 as a sanity
  cap).
- `durationUnit`: one of `years | months | days`.
- `warranties`: array, optional (default `[]`), max **10** terms per item.

The sale payload does **not** accept client-sent warranties — they are snapshotted
server-side from the item (like cost/suggestedPrice), so the sale Zod schema is
unchanged.

## 8. Acceptance criteria (checklist)

- [ ] Item form adds/edits/removes multiple warranty terms; they persist and reload.
- [ ] Selling an item with terms snapshots them onto the sale line (asserted in a
      service test + visible on Sale Detail).
- [ ] **Editing the item's warranties after a sale does NOT change the past sale's
      snapshot** (regression test — the immutability guarantee).
- [ ] Quick lines never carry warranties.
- [ ] Sale Detail shows per-term Valid-until / Expired status vs a chosen claim date,
      defaulting to today; changing the date re-computes live.
- [ ] Expiry math is correct for years/months/days incl. the end-of-month clamp and
      leap-day case — covered by pure unit tests.
- [ ] Backward compatible: pre-feature items/sales render cleanly ("No warranty on
      record"), no migration, no error.
- [ ] No new money/stock writes; the snapshot rides inside the existing sale txn.
- [ ] Works fully through the UI with no AI.

## 9. Open questions for the owner — RESOLVED (2026-06-27)

1. **Warranty start date → `Sale.date`** (the receipt date), NOT `createdAt`. The
   warranty clock runs from when the customer actually bought the item — what their
   receipt/warranty card says. `createdAt` would be subtly wrong for any back-dated,
   imported, or re-entered sale, which are exactly the cases where correctness
   matters. Same `date`-vs-`createdAt` principle the project already follows.
2. **Finding the sale → existing Sale History / khata.** No dedicated warranty lookup
   screen. No serial numbers means a search screen can't pinpoint the physical unit
   anyway; the realistic flow is find the sale, open Sale Detail, read status there.
3. **Label optional**, blank renders as "Warranty".
4. **Just answer valid/expired** — no claim/RMA log in v1.
5. **Units: years / months / days.**

## 10. Notes / decisions

- This is the **`costAtTime` pattern reused for warranty**: read mutable item state
  in-txn, snapshot the physical fact onto the immutable line, derive everything else
  on read. Worth a short DECISIONS.md entry (ADR-017) if accepted, since it sets the
  precedent "any new per-sale fact that can change on the item gets snapshotted, not
  re-derived."
- Reuses the heterogeneous-line `kind` branch from ADR-016 (snapshot only when
  `kind === "item"`).
