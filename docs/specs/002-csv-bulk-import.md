# Spec: 002 — CSV bulk import (items)

- **Status:** accepted (decisions confirmed by owner 2026-06-20; build in progress)
- **Phase:** Phase 1 — Inventory core (completes it)
- **Author / date:** owner / 2026-06-20
- **Builds on:** spec 001 (Item, Category, StockMovement, Counter, Settings models;
  Decimal128 quantities; integer-paisa prices; opening-stock-as-movement; rs0 transactions).
- **Decisions recorded in:** `docs/DECISIONS.md` ADR-004 (insert-only, file stash, counter
  not burned, locked headers, ImportLog).

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
- A **downloadable template CSV** with the locked headers (§7.1) + 1–2 example rows. A short
  instructions note tells owners to format SKU/number columns as **Text** in Excel and to save
  as plain CSV (UTF-8).
- **Upload** a **CSV file (only — no `.xlsx`)**, parse it server-side with **papaparse**. The
  browser reads the file and POSTs its raw text as the request body (`text/csv`); no multipart
  upload library is used (decision: avoid a second dependency — see §6).
- **Two-phase flow: validate/preview → confirm/commit.** Nothing is written until the owner
  confirms. The parsed upload is held in a **short-lived server-side stash keyed by an import
  token** (with a TTL); commit re-reads and re-validates from the stash, never trusting a
  client-posted preview.
- **Preview** showing per-row outcome: will-create / will-update / will-skip (error), with the
  reason for each error and a summary count.
- **Commit** that imports all valid rows; invalid rows are skipped and reported (partial
  import), NOT an all-or-nothing abort (see decision in §6).
- **Auto-create missing categories** referenced by name — but only the ones that appear in the
  file, surfaced in the preview so the owner sees "3 new categories will be created" before
  confirming. New categories are created **up front, before any row transaction**, deduped
  case-insensitively **including within the file** (so "Wire" / "wire" → one category). Prefix
  derived with the existing `deriveSkuPrefix()` — no special collision handling (collisions are
  harmless: categories sharing a prefix share its counter; SKUs stay unique — spec 001 §9.2).
- Per-row: same validation rules as spec 001 §7 (name, baseUnit enum, prices, etc.).
- SKU handling: blank SKU → auto-generate (reuse the spec 001 atomic counter, **at commit
  only**); provided SKU → validate uniqueness (case-insensitive) against the DB and the file.
- **Insert-only:** a row whose SKU already exists in the DB is an **error/skip**, never an
  update. (An "allow updates" mode may be added later behind an explicit opt-in; not now.)
- Opening stock column → writes an opening `adjustment` movement per item, same as spec 001
  create (inside the import transaction).
- **Downloadable error report** (the failed rows + reasons) after a commit.

**Out of scope (explicitly not now):**
- **Update of existing items** by SKU (insert-only this spec; opt-in update mode is a later
  addition — when built, its preview must show a per-field diff).
- Bulk *update* of avgCost / purchases (that's Phase 2).
- Multi-unit (`units[]`) import.
- `.xlsx` upload (CSV only; revisit if typing into raw CSV proves to be a dealbreaker).
- Images / barcodes.
- Background/async job queue for huge files (see §6 size cap; revisit only if needed).
- Undo/rollback of a completed import (mitigated by the preview step + ImportLog audit;
  reconsider later).

## 4. UI / flow
**Access: owner-only.** The import entry point and both endpoints are gated to the `owner`
role (placeholder auth today attaches a dev user — gate properly once real auth lands; see §6).

1. **Import page / modal**, reached from the Inventory page ("Import from CSV").
2. "Download template" button → gives the correct CSV.
3. File picker → upload. Client does light checks (is it a CSV, not empty); real validation is
   server-side.
4. Server parses and returns a **preview**: a table of rows with a status badge
   (Create / Update / Error) and, for errors, the reason. A summary header:
   "120 to create, 8 to update, 5 errors, 3 new categories will be created."
5. Owner reviews. Two buttons: **Import valid rows** (proceeds, skipping errors) and **Cancel**.
   Optionally: "fix errors and re-upload" guidance. The UI states that the **preview is
   advisory**: the actual result is computed at commit (another user could change the DB in
   between), so the final counts are authoritative.
6. On confirm → commit (re-validates from the stashed file via the import token) → result
   screen: "120 created, 5 skipped." Plus **Download error report** for the skipped rows.

**Unhappy paths:** empty file; wrong/missing headers (reject the whole file with a clear
"expected columns: …" message, since the file is unusable); file too large (over the cap);
a row that's valid in isolation but collides with another row *in the same file* (duplicate SKU
within the upload — must be caught, see §6).

## 5. Data model changes
Reuses spec 001 models (Item, Category, StockMovement, Counter, Settings) — no changes to them.

**New: `ImportLog` collection** (confirmed — build now). The only audit trail for a bulk
operation that has no per-item undo. Minimal fields:
- `filename` — string (as uploaded; informational).
- `createdBy` — ObjectId ref `User`, required (the importer).
- `counts` — `{ created, skipped, newCategories }` integers.
- `errorReport` — the failed rows + reasons (stored so the audit record is self-contained;
  same shape as the downloadable report, §6). Optional/empty when nothing failed.
- `timestamps: true` (the `createdAt` is the import time).

One ImportLog document is written **per commit** (not per preview). Previews write nothing.

## 6. Business rules (be precise — this is where bugs live)
- **Upload transport:** the browser reads the chosen file and POSTs its **raw text** as the
  request body with content-type `text/csv`. The backend parses it with **papaparse**. We do
  **not** add a multipart/file-upload library (e.g. multer) — papaparse is the one approved new
  dependency. Body size is capped (§ file size cap) via the body parser limit.
- **Preview → commit handshake:** preview parses + validates and stores the parsed upload in a
  **short-lived in-memory server stash keyed by a random import token**, returned to the client
  with a TTL. Commit sends back only the token; the server re-reads the stashed upload and
  **re-validates from scratch** (don't trust any preview the client echoes back). If the token
  is missing/expired, commit fails with "preview expired — please re-upload." The durable record
  of what happened is the `ImportLog` (§5), not the stash.
- **Preview never writes and never burns the SKU counter.** Auto-SKUs are generated (via the
  atomic counter, §spec 001 §9.2) **only at commit**. In the preview, an auto-SKU row shows
  `(auto)`. (A test asserts the `Counter` collection is unchanged after a preview.)
- **Validate-then-commit, never parse-and-write in one go.** Preview is computed from a
  dry-run; commit re-validates server-side from the stashed file.
- **Partial import (skip-and-report), not all-or-nothing.** A bad row does not abort the
  import; valid rows still load, bad rows are reported. Rationale: with hundreds of rows, one
  typo aborting everything is the wrong UX. (The preview step is what protects against
  surprises, not transaction-wide rollback.)
- **Reuse `createItem()` per row.** The commit loop is a thin layer over the existing tested
  `itemService.createItem()` (spec 001): parse row → resolve `categoryName`→`categoryId` (using
  the up-front-created categories) → call `createItem()` in its own per-row transaction → catch
  and record the outcome. This guarantees one way to parse money/quantities, atomic SKU, and the
  opening-stock movement. Do **not** reimplement any of that.
- **Transaction granularity:** each item + its opening-stock movement is created in **one
  transaction per row** (via `createItem`), so a row either fully lands or fully fails. The
  import is a loop of per-row transactions, not one giant transaction (a single 10,000-row
  transaction would be slow and risky on rs0).
- **Category auto-create up front:** all new categories are resolved/created **before** the row
  loop, deduped case-insensitively **including within the file**, so a row-transaction rollback
  can never orphan or duplicate a category. Prefix from `deriveSkuPrefix()`; no collision rule.
- **Money:** price columns entered in **rupees** in the CSV (human-friendly), converted to
  integer paisa on import (`× 100`). Reject non-numeric / negative; retailPrice must be > 0.
  **Reject any price with more than 2 decimal places** — never round money silently (e.g.
  `1250.555` is an error, not `125056` paisa). Reject thousands separators / currency symbols
  (`1,250`, `Rs 1250`) with a clear "digits and a single optional decimal point only" message.
- **Blank vs garbage for optional cells:** a **blank** optional cell (`wholesalePrice`,
  `reorderLevel`, `openingStock`, `sku`) means "use the default"; a **non-empty but invalid**
  value is an **error** — the two are never conflated.
- **Quantities:** opening-stock column parsed to **Decimal128**; reject invalid decimals
  (never coerce to 0), same rule as spec 001 §7.
- **Categories:** referenced by **name** in the CSV. Case-insensitive match against existing
  categories so "Wire" and "wire" don't create duplicates. Missing categories are created **up
  front** (see above), deduped case-insensitively within the file too. Surfaced in preview as
  "N new categories will be created".
- **SKU:** blank → auto-generate via the counter **at commit**; provided → must be unique
  case-insensitively against (a) the existing DB and (b) other rows in the same file. A
  duplicate within the file is an error on the later row. The DB-uniqueness check across all
  provided SKUs is done in **one batched query**, not one query per row.
- **Create vs update — INSERT ONLY.** A row whose SKU already exists in the DB (active **or**
  inactive) is an **error/skip**, never an update; the skip reason names whether the existing
  item is inactive. No update path is built in this spec.
- **Duplicate item within the file:** two rows with the **same name + same category** (after the
  category resolves) are surfaced as a **warning** in the preview (not a hard error) — the owner
  may legitimately have two, but it's usually a mistake.
- **Performance:** the row loop caches resolved categories in memory (no per-row category
  query). SKU-existence is one batched query (above). Per-row transactions are sequential.
- **File size cap:** **10,000 rows / 10 MB.** Larger files are rejected before/after parse with
  guidance to split the file, until/unless we build an async job.

## 7. Validation rules (per row)

### 7.1 Locked template headers
The canonical column headers (exact strings, this order in the template):

```
name, categoryName, baseUnit, retailPrice, wholesalePrice, reorderLevel, openingStock, sku
```

- **Required headers** (whole-file reject if any is missing): `name`, `categoryName`,
  `baseUnit`, `retailPrice`.
- **Optional headers**: `wholesalePrice`, `reorderLevel`, `openingStock`, `sku`. If a column is
  absent, every row is treated as blank for it (→ default).
- Unknown extra columns are **ignored** (not an error).
- Header matching is **case-insensitive and trimmed**, and a leading **UTF-8 BOM is stripped**
  before matching (Excel "Save as CSV" prepends one, which otherwise corrupts the first header).
- Renaming these headers is a breaking change for owners' saved files — they are locked
  (recorded in DECISIONS.md ADR-004).

### 7.2 Per-row field rules
Same field rules as spec 001 §7, applied per CSV row, plus:
- Required columns present (header check on the whole file first, §7.1).
- name: required, 1–120 chars.
- categoryName: required; matched case-insensitively or created.
- baseUnit: required, must be in the enum (gaz, meter, kg, piece, dozen, coil, set) — reject
  unknown units with a clear message listing valid ones.
- retailPrice: required, numeric (rupees) > 0, **≤ 2 decimal places** (else error).
- wholesalePrice: optional, numeric (rupees) ≥ 0, ≤ 2 decimal places.
- reorderLevel: optional, integer ≥ 0 (default 0).
- openingStock: optional, valid decimal ≥ 0 (default 0).
- sku: optional; if present, alphanumeric + hyphen, unique (case-insensitive) vs DB and vs
  file.
- Row-level errors collect ALL problems for that row (don't stop at the first), so the owner
  can fix everything in one pass.

## 8. Acceptance criteria (checklist)
- [ ] Template CSV downloads with the locked headers (§7.1) + example row(s).
- [ ] Uploading a valid file shows an accurate preview (create/skip counts + new categories +
      duplicate-in-file warnings) and writes nothing — **and does not advance the SKU counter**.
- [ ] Confirming (with the import token) re-validates from the stash and imports valid rows;
      each item + opening movement lands in one per-row transaction; skipped rows are reported;
      an expired/missing token fails with a clear "re-upload" message.
- [ ] An existing-SKU row is skipped as an error (insert-only), never updated; the reason names
      an inactive existing item when relevant.
- [ ] Missing categories are auto-created up front (case-insensitive, no duplicates incl. within
      the file) and shown in preview before commit.
- [ ] Blank SKU auto-generates via the counter **at commit only**; provided SKU validated
      against DB (batched) and within the file; in-file duplicates caught.
- [ ] Prices parsed rupees→paisa; **>2-dp prices rejected** (no silent rounding); commas/symbols
      rejected; opening stock parsed to Decimal128; invalid numbers/decimals rejected, never
      coerced; blank optional cell → default, non-empty invalid → error.
- [ ] Wrong/missing headers reject the whole file with a clear "expected columns: …" message; a
      leading BOM is stripped; empty file handled; oversized file (>10k rows / >10 MB) rejected
      with guidance to split.
- [ ] Error report (original columns + row number + `_error` column, re-uploadable) downloadable
      after commit; an `ImportLog` document is written per commit.
- [ ] Import endpoints + UI entry are owner-only; opening movements record `createdBy` = importer.
- [ ] Works fully through the UI with no AI.
- [ ] Tests cover: header validation (incl. BOM), rupees→paisa + >2-dp reject + Decimal128
      parsing, blank-vs-garbage, preview accuracy + **counter unchanged after preview**, in-file
      duplicate SKU, duplicate name+category warning, category auto-create + dedupe (incl.
      within-file), partial import (good rows land, bad skipped), existing-SKU = skip, and that a
      row failure mid-commit rolls back just that row.

## 9. Decisions from the owner (answered 2026-06-20)
1. **File format → CSV only.** No `.xlsx`. Approved one new dependency: **papaparse** (CSV
   parser). Upload transport is raw `text/csv` body — no multipart library. (§3, §6)
2. **Existing SKU → error/skip (INSERT ONLY).** Never update on a SKU collision; report the row
   as an error (and say so when the existing item is inactive). An opt-in "allow updates" mode
   may come later with a per-field diff preview. (§6)
3. **skuPrefix for auto-created categories → reuse `deriveSkuPrefix()`, no collision rule.**
   Prefixes need not be unique; categories sharing a prefix share its per-prefix counter and
   SKUs still stay unique (spec 001 §9.2). A "collision" is harmless by design. (§3, §6)
4. **Opening stock = movement → yes.** Reusing `createItem()` writes the opening `adjustment`
   movement inside the per-row transaction automatically. (§6)
5. **ImportLog → build now (minimal).** It's the only audit trail for an operation with no
   per-item undo. (§5)
6. **Row / file cap → 10,000 rows / 10 MB.** Reject larger with "split the file". (§6)
7. **Decimal/locale → reject, don't strip.** No thousands separators or currency symbols;
   digits and a single optional decimal point only. Prices: ≤ 2 decimal places. (§6, §7)

## 10. Notes / decisions
- Re-uses the per-row transaction pattern, `createItem()`, and all parsing rules from spec 001 —
  consistency here is the point; do not invent a second way to parse money/quantities.
- papaparse is the only approved new dependency. Anything else (e.g. `.xlsx`/SheetJS, multer)
  must be approved per CLAUDE.md before install.
- Hard-to-change decisions recorded in `docs/DECISIONS.md` **ADR-004**: insert-only, the
  preview→commit file stash + token + TTL, preview-never-burns-counter, the locked header
  strings, and the ImportLog collection.

## 11. Build order
1. Parser + header validation + template download (with tests).
2. Preview endpoint, incl. the counter-not-burned test. **← pause here and show the owner.**
3. Commit + error report (the riskiest piece) — built only after the preview is reviewed.
4. UI (import page, preview table, result screen, downloads).