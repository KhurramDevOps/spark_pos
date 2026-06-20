# Spec: 002 — CSV / Excel bulk import (items)

- **Status:** draft
- **Phase:** Phase 1 — Inventory core (completes it)
- **Author / date:** <you> / <fill in>
- **Builds on:** spec 001 (Item, Category, StockMovement, Counter, Settings models;
  Decimal128 quantities; integer-paisa prices; opening-stock-as-movement; rs0 transactions).

## 1. Problem / goal
Entering thousands of items one-by-one through the Add-item form is the single biggest
bottleneck in the whole project. We need to load items in bulk from a spreadsheet (CSV) — the
owner prepares a file, uploads it, sees clearly what will happen, and confirms. This is what
makes cataloguing the real shop feasible. **Items only in this spec** — no purchases, sales, or
suppliers.

## 2. User stories
- As the owner, I want to download a template CSV with the right columns, so I know exactly
  what format to fill in.
- As the owner, I want to upload a filled CSV and see a preview of what will be created,
  updated, or rejected **before** anything is saved, so I never corrupt my catalogue by
  accident.
- As the owner, I want bad rows to be reported clearly (which row, what's wrong) while the good
  rows still import, so one typo doesn't waste the whole file.
- As the owner, I want to download a report of what failed, so I can fix just those rows and
  re-upload them.

## 3. Scope
**In scope:**
- A **downloadable template CSV** (correct headers + 1–2 example rows + a short instructions
  row or companion note).
- **Upload** a CSV file (also accept `.xlsx`? — see open questions), parse it server-side.
- **Two-phase flow: validate/preview → confirm/commit.** Nothing is written until the owner
  confirms.
- **Preview** showing per-row outcome: will-create / will-update / will-skip (error), with the
  reason for each error and a summary count.
- **Commit** that imports all valid rows; invalid rows are skipped and reported (partial
  import), NOT an all-or-nothing abort (see decision in §6).
- **Auto-create missing categories** referenced by name — but only the ones that appear in the
  file, surfaced in the preview so the owner sees "3 new categories will be created" before
  confirming.
- Per-row: same validation rules as spec 001 §7 (name, baseUnit enum, prices, etc.).
- SKU handling: blank SKU → auto-generate (reuse the spec 001 atomic counter); provided SKU →
  validate uniqueness (case-insensitive).
- Opening stock column → writes an opening `adjustment` movement per item, same as spec 001
  create (inside the import transaction).
- **Downloadable error report** (the failed rows + reasons) after a commit.

**Out of scope (explicitly not now):**
- Bulk *update* of avgCost / purchases (that's Phase 2).
- Multi-unit (`units[]`) import.
- Images / barcodes.
- Background/async job queue for huge files (see §6 size cap; revisit only if needed).
- Undo/rollback of a completed import (mitigated by the preview step; reconsider later).

## 4. UI / flow
1. **Import page / modal**, reached from the Inventory page ("Import from CSV").
2. "Download template" button → gives the correct CSV.
3. File picker → upload. Client does light checks (is it a CSV, not empty); real validation is
   server-side.
4. Server parses and returns a **preview**: a table of rows with a status badge
   (Create / Update / Error) and, for errors, the reason. A summary header:
   "120 to create, 8 to update, 5 errors, 3 new categories will be created."
5. Owner reviews. Two buttons: **Import valid rows** (proceeds, skipping errors) and **Cancel**.
   Optionally: "fix errors and re-upload" guidance.
6. On confirm → commit → result screen: "120 created, 8 updated, 5 skipped." Plus **Download
   error report** for the skipped rows.

**Unhappy paths:** empty file; wrong/missing headers (reject the whole file with a clear
"expected columns: …" message, since the file is unusable); file too large (over the cap);
a row that's valid in isolation but collides with another row *in the same file* (duplicate SKU
within the upload — must be caught, see §6).

## 5. Data model changes
None required — reuses spec 001 models (Item, Category, StockMovement, Counter, Settings).

Optional (decide in review): an **ImportLog** collection recording each import (timestamp,
createdBy, filename, counts created/updated/skipped) for audit. Recommended but low priority;
flag if you want it now.

## 6. Business rules (be precise — this is where bugs live)
- **Validate-then-commit, never parse-and-write in one go.** Preview is computed from a
  dry-run; commit re-validates server-side (don't trust the preview the client sends back —
  re-read the file or a server-held parsed copy).
- **Partial import (skip-and-report), not all-or-nothing.** A bad row does not abort the
  import; valid rows still load, bad rows are reported. Rationale: with hundreds of rows, one
  typo aborting everything is the wrong UX. (The preview step is what protects against
  surprises, not transaction-wide rollback.)
- **Transaction granularity:** each item + its opening-stock movement is created in **one
  transaction per row** (consistent with spec 001), so a row either fully lands or fully
  fails. The import is a loop of per-row transactions, not one giant transaction (a single
  10,000-row transaction would be slow and risky on rs0). Decide in review if a small batch
  size is preferable.
- **Money:** price columns entered in **rupees** in the CSV (human-friendly), converted to
  integer paisa on import. Reject non-numeric / negative; retailPrice must be > 0.
- **Quantities:** opening-stock column parsed to **Decimal128**; reject invalid decimals
  (never coerce to 0), same rule as spec 001 §7.
- **Categories:** referenced by **name** in the CSV. If the name doesn't exist, create it
  (with a derived skuPrefix — see open questions) during commit, inside the relevant row's
  flow. Surfaced in preview. Case-insensitive match against existing categories so "Wire" and
  "wire" don't create duplicates.
- **SKU:** blank → auto-generate via the counter; provided → must be unique case-insensitively
  against (a) the existing DB and (b) other rows in the same file. A duplicate within the file
  is an error on the later row.
- **Create vs update:** decide the rule (see open questions) — does a row with an existing SKU
  update that item, or is it an error? This changes everything about the "Update" path.
- **File size cap:** set a sensible max (e.g. 5,000 rows or a few MB) and reject larger files
  with guidance to split, until/unless we build an async job.

## 7. Validation rules (per row)
Same field rules as spec 001 §7, applied per CSV row, plus:
- Required columns present (header check on the whole file first).
- name: required, 1–120 chars.
- categoryName: required; matched case-insensitively or created.
- baseUnit: required, must be in the enum (gaz, meter, kg, piece, dozen, coil, set) — reject
  unknown units with a clear message listing valid ones.
- retailPrice: required, numeric (rupees) > 0.
- wholesalePrice: optional, numeric ≥ 0.
- reorderLevel: optional, integer ≥ 0 (default 0).
- openingStock: optional, valid decimal ≥ 0 (default 0).
- sku: optional; if present, alphanumeric + hyphen, unique (case-insensitive) vs DB and vs
  file.
- Row-level errors collect ALL problems for that row (don't stop at the first), so the owner
  can fix everything in one pass.

## 8. Acceptance criteria (checklist)
- [ ] Template CSV downloads with correct headers + example row(s).
- [ ] Uploading a valid file shows an accurate preview (create/update/skip counts + new
      categories) and writes nothing yet.
- [ ] Confirming imports valid rows; each item + opening movement lands in one per-row
      transaction; skipped rows are reported.
- [ ] Missing categories are auto-created (case-insensitive, no duplicates) and shown in
      preview before commit.
- [ ] Blank SKU auto-generates via the counter; provided SKU validated against DB and within
      the file; in-file duplicates caught.
- [ ] Prices parsed rupees→paisa; opening stock parsed to Decimal128; invalid numbers/decimals
      rejected, never coerced.
- [ ] Wrong/missing headers reject the whole file with a clear message; empty file handled;
      oversized file rejected with guidance.
- [ ] Error report downloadable after commit (failed rows + reasons).
- [ ] Works fully through the UI with no AI.
- [ ] Tests cover: preview accuracy, partial import (good rows land, bad skipped), category
      auto-create + dedupe, in-file duplicate SKU, rupees→paisa + Decimal128 parsing, header
      validation, and that a row failure mid-commit rolls back just that row.

## 9. Open questions for the owner / review
1. **File format:** CSV only to start, or also accept Excel `.xlsx`? (CSV is simpler and
   universal; xlsx is friendlier but needs a parser library — would need approval per CLAUDE.md.)
2. **Existing SKU = update or error?** If a CSV row has an SKU that already exists: update that
   item's fields, or treat it as an error/skip? (Update is powerful but riskier — a stray SKU
   could overwrite a good item. Recommend: **error/skip by default**, and consider an explicit
   "allow updates" checkbox on the import screen later.)
3. **skuPrefix for auto-created categories:** how to derive it from the category name? (e.g.
   first 3 letters uppercased — but collisions are possible: "Wire" and "Winding" both → WIN/WIR?
   Propose a rule, and what happens on prefix collision.)
4. **Opening stock import = movement?** Confirm imported opening stock writes an opening
   `adjustment` movement per item (consistent with spec 001), so the audit trail and stockQty
   stay paired. (Recommend yes.)
5. **ImportLog collection** (§5) — build the audit record now, or defer?
6. **Row cap / file size** — what's a realistic max for the shop's biggest single upload?
7. **Decimal/locale in CSV** — will numbers ever use commas (e.g. "1,250")? Decide whether to
   strip thousands separators or reject them.

## 10. Notes / decisions
- Re-uses the per-row transaction pattern and all parsing rules from spec 001 — consistency
  here is the point; do not invent a second way to parse money/quantities.
- If `.xlsx` or any CSV-parsing library is needed, it's a new dependency → must be approved per
  CLAUDE.md before install.
- Record any confirmed decisions (SKU-collision rule, update-vs-error, ImportLog) in
  DECISIONS.md.