# Spec: 006b — Product images (inventory + POS polish)

- **Status:** in-progress (review complete; building storage driver + tests first)
- **Phase:** Phase 6 polish — visual upgrade to inventory/POS/item picker.
- **Author / date:** <you> / <fill in>
- **Builds on:** Item model (spec 001), Inventory CRUD UI, POS item picker (spec 004),
  Reports item performance (spec 006). Touches no money/stock/cost logic. Adds the project's
  first piece of infrastructure-shaped code: a small storage-driver abstraction so the
  same image-handling code works against local disk now and against object storage (S3/R2)
  after deployment, without rewriting the upload pipeline.

## 1. Problem / goal
The shop sells electronics (fans, bulbs, water pumps, wires, etc.) — visually distinct items
that are much faster to identify by sight than by SKU. Currently:

- Inventory is a SKU/text-only list. Finding "the GFC bracket fan" means scrolling rows or
  searching by name, when a thumbnail would be one glance.
- The POS item picker (during a live sale) is the same — text only. At the counter, when a
  customer points at something, matching it to an inventory row is slower than it should be.
- Item performance in Reports is text-only too. Pictures make at-a-glance scanning of "what
  sells" much easier.

Goal: attach a single image to each item (optional but encouraged), display it cleanly as a
thumbnail in the three screens that benefit (Inventory, POS picker, Item performance), and
support hover-to-enlarge for quick visual confirmation without opening the item detail.

## 2. Why this spec needs more architectural care than 005 / 006
Phases 1–6 were pure business logic — every byte was JSON. This is the first feature that
deals with **binary content and a filesystem**. Three things make this category different
and deserve explicit decisions up front:

1. **Storage location.** Images don't belong in MongoDB — putting binary blobs (Base64 or
   GridFS) inside MongoDB bloats the working set, slows queries that touch Item, and turns
   `mongodump` into a slow file-transfer operation. The right place for image bytes is a
   filesystem (local disk now) or object storage (S3/R2/Cloudflare Images, later, in prod).
   MongoDB stores **a reference** (a path or URL string), nothing more. This is the
   industry-standard pattern; see DECISIONS for the ADR.
2. **Local-now / cloud-later.** This app will deploy. On the deployment target, the local
   disk may be ephemeral (containers wipe on redeploy), or multi-instance (each instance
   has its own disk), or both. Code that hard-codes `fs.writeFile('./uploads/...')` will
   break on day one of production. Solution: a tiny storage-driver interface from day one,
   with `LocalDiskDriver` (now) and `S3Driver` (slot-in for prod) as implementations. Same
   interface, same Item.image shape, different driver picked by env var.
3. **Image processing.** A 4MB phone photo will tank the inventory page if loaded raw.
   Every uploaded image gets resized + re-encoded at upload time (Sharp library, 5 lines)
   to a sensible size and quality. Stored thumbnail size is small (kilobytes, not megabytes).

Everything else — the UI, the validation, the user flow — is light. The infrastructure
decisions in §2 are what makes this spec slightly heavier than 005/006.

## 3. User stories
- As the owner adding a new item, I want to attach a picture by uploading from my computer
  OR by pasting a URL — whichever is easier for that item — so I don't have to choose one
  source over the other.
- As the owner editing an existing item, I want to add, replace, or remove its picture
  without affecting any other field.
- As anyone looking at Inventory, I want to see a small thumbnail next to each row at a
  glance, and hover the thumbnail to see a bigger preview without clicking through.
- As the owner ringing up a sale, I want the POS item picker to show thumbnails so I can
  match what the customer is pointing at to the right item faster.
- As anyone reading Reports, I want item performance to show thumbnails so "what sells"
  is visual, not just a SKU list.
- As the owner, I want missing-image items to look clean (a tasteful placeholder, not a
  broken-image icon), so half-filled inventory doesn't look unfinished.

## 4. Scope
**In scope:**
- **Image source: either upload OR URL, per item.** Single image per item (no galleries).
  The Item gets one new field, `image`, that stores `{ kind: 'upload' | 'url', ref: string }`
  — `ref` is a storage key (for uploads) or the external URL (for URLs).
- **Upload flow:** drag-and-drop OR file-picker, into the Add/Edit Item modal.
  (Paste-from-clipboard is DEFERRED — it needs paste-event blob extraction for marginal
  gain; revisit post-v1.) Accepted types: JPEG, PNG, WebP. Max input size: 10 MB (rejected at
  the boundary; never stored). Server-side resize on upload to **max 800px long edge,
  JPEG quality 80**, producing thumbnails well under 200 KB each. Original is NOT kept —
  the resized version replaces it. This is intentional: one canonical asset per item, no
  size proliferation, no transformation pipeline.
- **URL flow:** paste a URL, validate it parses as a URL with http(s) scheme, save the
  string. No fetching or caching server-side (URLs are rendered directly by the browser
  on display). Lightly warn the user that URLs can rot — but don't block.
- **Replace / remove:** editing an item lets you replace its image (uploads the new one,
  deletes the old stored file if the old image was an upload), or remove it entirely
  (clears the field, deletes the stored file if applicable).
- **Display surfaces (3, in this exact priority order):**
  1. **Inventory list** — square thumbnail (~48px) at the left of each row. Hover →
     ~280px preview floating to the right of the thumbnail (CSS positioned, no JS lib),
     250ms fade-in, dismisses on mouseleave. Missing image → tasteful gray placeholder
     with a small icon.
  2. **POS item picker** — thumbnail (~40px) in each search result row. Hover-preview
     same as inventory. This is the highest-leverage screen visually — at the counter,
     this is where seconds get saved.
  3. **Reports → Item performance table** — small thumbnail (~32px) next to item name.
     No hover preview here (the table is scannable, and hover-preview during a deep
     analytical read is more distraction than help).
- **A "no image" placeholder design** that doesn't look broken. Light gray box, centered
  small icon (camera or box icon from a small icon set), same dimensions as a real
  thumbnail. Used everywhere an image is absent.
- **Storage driver abstraction:** a tiny `lib/storage/` module exposing `put(buffer,
  keyHint) → key`, `delete(key)`, and `urlFor(key) → string`. Two implementations:
  `LocalDiskDriver` (writes to `backend/uploads/items/`, served at `/api/static/items/<key>`)
  and a stub `S3Driver` (interface only for now, with TODO markers — not actually
  implemented until deployment time). Driver chosen by `STORAGE_DRIVER` env var.
- **A new static-file route** in Express, `GET /api/static/items/:key`, that the
  LocalDiskDriver uses to serve the saved files. The `/api` prefix is deliberate: it keeps
  the single existing Vite dev proxy rule (`/api → :5001`) covering images too, preserves
  the one-origin assumption (the frontend builds no non-`/api` URLs), and keeps prod deploy
  simpler. Owner-only is **not** required for reading images (they're not sensitive); the
  route is public-read. Uploading is owner-only, same as every other write.

**Out of scope:**
- **Multiple images per item / galleries.** One image, one slot. If owner needs to
  represent variants (color, size), they're separate items with separate SKUs anyway.
- **Image cropping / editing in-app.** Owner is the one taking/picking photos; they can
  crop in their own tools before upload. No in-app cropper.
- **CDN, image transformation pipeline, multiple sizes (small/medium/large).** One stored
  size (resized at upload), used everywhere, displayed at different CSS sizes. Pre-mature
  to ship a multi-size pipeline; revisit if/when measured load times demand it.
- **Bulk image upload via CSV import.** Adding an `imageUrl` column to the CSV importer
  IS in scope as a small addition (it's just a string field validated as URL) but bulk
  file upload is not. Owner adds upload-type images one at a time via the Edit Item modal.
- **Image search / similar-items.** Phase 7 AI territory if ever.
- **EXIF stripping, content moderation, watermarking.** Not needed at this scale; owner
  controls every image personally.
- **Backfilling existing items.** Adding images is incremental — every existing item
  starts with no image and shows the placeholder until owner edits it to add one.

## 5. Data model changes
- **Item — new optional field:**
  ```
  image: {
    kind: 'upload' | 'url'   // enum, required if image present
    ref:  string             // storage key (for upload) or full URL (for url)
    updatedAt: Date          // server-set, bust browser cache on replace
  } | null                   // null/absent = no image; render placeholder
  ```
  Stored as a sub-document on Item. Absent / null means "no image." No separate
  collection — images are 1:1 with items, lifecycle bound to the item.
- **No changes** to any other model (Sale, Purchase, etc.). Sale lines DO NOT snapshot
  the item's image at sale time. This is a deliberate decision: images are decorative, not
  financial. `costAtTime` stays the only thing snapshotted. Sale history is text-only and
  shows NO thumbnails (see §8) — and the `getSale` populate projection
  (`.populate("lines.itemId", "name sku baseUnit")`) deliberately does NOT include `image`,
  so the regression holds even if someone later forgets this rule.
- **Filesystem layout (LocalDiskDriver):**
  - `backend/uploads/items/<key>.jpg` — resized JPEGs, key is `<itemId>-<timestamp>.jpg`
    so replacing an image generates a new key (browser cache bypassed naturally) and the
    old key is deleted explicitly. Served at `GET /api/static/items/<key>`.
  - `backend/uploads/.gitignore` containing `*` so nothing in here is tracked by git.
  - Directory created on first upload if missing.
- **Indexes:** none new needed. Image presence isn't queried.

## 6. Business rules
- **Image is optional everywhere.** No flow ever blocks on missing image.
- **One image per item.** Replacing deletes the old file (if upload-type) before writing
  the new one. Removing clears the field and deletes the file.
- **Validation at upload boundary:** type ∈ {image/jpeg, image/png, image/webp}, raw size
  ≤ 10 MB. Both checks on the server, not just the browser. Rejected uploads return a
  clear error, never partially-written files.
- **Resize is mandatory.** Every uploaded image is processed through Sharp before being
  stored: `.rotate()` (honor EXIF orientation, then strip EXIF), `.resize({ width: 800,
  height: 800, fit: 'inside', withoutEnlargement: true })`, `.jpeg({ quality: 80,
  mozjpeg: true })`. Output is always JPEG regardless of input. Single canonical format
  simplifies serving and caching.
- **URL validation at the boundary:** must `new URL()`-parse, must have `http:` or
  `https:` protocol, no other constraints. Don't HEAD-check the URL on save — that adds
  a network dependency and slows the form; let bad URLs surface as broken images at
  display time, with a graceful fallback to the placeholder.
- **Cache busting:** the `updatedAt` field on the image sub-doc is appended as a query
  param when the frontend constructs the `<img src>`: `/api/static/items/<key>?v=<ts>`.
  This ensures replacing an image immediately reflects in already-loaded browser tabs
  without aggressive cache headers. (This is an `<img src>`, not an `apiClient` fetch, so
  no apiClient change is needed.)
- **Storage driver picked by env var.** `STORAGE_DRIVER=local` (default) →
  LocalDiskDriver. `STORAGE_DRIVER=s3` → S3Driver (stub for now; throws "not implemented"
  until you wire it for production). Same Item.image shape regardless.
- **Deletion safety:** deleting an upload-backed image deletes the file AFTER the DB
  field is cleared (and re-checks the DB to ensure no other item somehow references the
  same key — unlikely but cheap). If file deletion fails (file already gone, permissions),
  log a warning but don't error the user-facing operation. The DB is source of truth;
  orphan files are tolerable and cleanable later.
- **No transactions involved.** Item update + file write are two systems (Mongo + disk).
  Order: write file → update Item.image → on Item-update failure, delete the just-written
  file. On replace: write new file → update Item → delete old file (in that order; old
  file deletion is best-effort).
- **Owner-only on writes.** Upload, replace, remove all owner-gated. Reading images is
  public (the static route has no auth).

## 7. Validation rules
- Item.image on save: if present, `kind` ∈ {'upload', 'url'} and `ref` is a non-empty
  string. If kind === 'url', ref must be a valid http(s) URL (shared `httpUrl` validator).
  If kind === 'upload', ref must match the format the driver returned (alphanumeric + `-` +
  `.jpg` for local). The image is then served at `GET /api/static/items/<ref>`.
- Upload endpoint: multipart/form-data (parsed by `multer`, memory storage), single field
  `file`, type ∈ allowed set, size ≤ 10 MB. Reject anything else with 400 and a clear
  message. (Drag-drop / file-picker only in v1; clipboard paste deferred.)
- URL endpoint (saved via the normal Item PATCH, not a separate route): same URL parse.
- Editing an existing item's image is a separate sub-route (`POST /items/:id/image` for
  upload, `DELETE /items/:id/image` for remove, and normal `PATCH /items/:id` for URL
  set/replace) so multipart handling stays isolated from the JSON PATCH flow.

## 8. Acceptance criteria (checklist)
- [ ] Uploading a JPEG/PNG/WebP via the Edit Item modal stores a resized JPEG and updates
      Item.image with kind='upload' and a fresh key.
- [ ] Uploaded image is ≤ 800px on the long edge and ≤ ~200 KB on a representative test
      image (regression: upload a known 4 MB photo, verify the stored file is well under
      that).
- [ ] Pasting an http(s) URL stores Item.image with kind='url' and the URL as ref.
- [ ] Replacing an upload image creates a new file, updates Item.image, and deletes the
      old file from disk.
- [ ] Removing an image clears Item.image and deletes the file (for upload type).
- [ ] Inventory list renders thumbnails; missing images show the placeholder cleanly.
- [ ] Hover on inventory thumbnail shows the larger preview within 250ms, smooth fade,
      dismisses on mouseleave; no layout shift.
- [ ] POS item picker renders thumbnails + hover preview, same pattern.
- [ ] Reports → Item performance renders thumbnails (no hover preview, by design).
- [ ] Sale history, Daily Close, Khata, Purchases — NO thumbnails (verify by inspection;
      these screens stay text-only / numbers-focused).
- [ ] Replacing an image is immediately reflected in already-loaded tabs (cache-busting
      via `?v=updatedAt` works).
- [ ] Uploading a 15 MB file is rejected at the server with a clear error; no partial
      file written.
- [ ] Uploading a `.txt` renamed to `.jpg` is rejected on MIME-sniff (Sharp will refuse
      to decode it — the rejection happens naturally and cleanly).
- [ ] Saving an item with a malformed URL is rejected; saving with `javascript:` or
      `file:` URL is rejected (only http/https accepted).
- [ ] CSV import accepts an optional `imageUrl` column; values are validated as URLs and
      stored as kind='url'. Invalid URLs in CSV → row-level error in the existing import
      preview, same UX as other invalid fields.
- [ ] Storage driver: STORAGE_DRIVER=local works; STORAGE_DRIVER=s3 throws a clear "not
      implemented; configure local for dev" error rather than silently misbehaving.
- [ ] Static route `/api/static/items/:key` returns 200 + image bytes for valid keys, 404
      for missing.
- [ ] Images load successfully through the dev proxy (`curl
      http://localhost:5173/api/static/items/<key>` returns 200 + image bytes — the single
      `/api` Vite proxy rule covers it).
- [ ] Owner-only on all write endpoints; static read route has no auth.
- [ ] Best-effort orphan cleanup: when deleting an upload-backed image and the file is
      already gone / unlinkable, the operation logs a warning and still succeeds (Item.image
      cleared, no 500 to the user).
- [ ] Visual smoke (manual): Inventory page with ~50 items feels snappy, AND thumbnails
      carry `loading="lazy"` so they don't all fetch at once (assert the attribute is present
      on rendered thumbnails — the CI-checkable part).
- [ ] Sale-time snapshot regression: a sale's item image change after the sale does NOT
      retroactively change anything in sale history (image is decorative, not snapshotted;
      `getSale` populate projection excludes `image`).

## 9. Decisions (resolved in review)
1. **Hover-preview:** **pure CSS** (positioned-absolute `:hover` → opacity/scale). No JS lib.
   Edge-clipping near the viewport edge is accepted as a minor cosmetic issue for v1. ✅
2. **Placeholder:** **light gray box + small icon** (camera/box). Most neutral; doesn't
   compete with real images. (Category-color and initials rejected — too noisy / read as
   "missing.") ✅
3. **CSV `imageUrl` column:** **IN this slice** — confirmed a small, clean addition (HEADERS
   entry + a `normalizeRow` block using the new shared `httpUrl` validator; preview UX is
   automatic). ✅
4. **POS success-panel thumbnails:** **DEFERRED.** Keeps the three-surface discipline (§10):
   money/confirmation screens stay text-only. Revisit only if real usage asks for it. ✅
5. **Reports thumbnail size:** **~32px**, in a fixed-size container so row height doesn't
   grow, with `loading="lazy"`. ✅
6. **S3 driver:** **stub now** (throws "not implemented"). Full impl needs a provider +
   credentials handling — a deploy-time concern. The interface is the seam. ✅
7. **Items without images:** no backfill UI; owner edits items as they come up — PLUS a small
   **"only items without images" filter chip** on Inventory (cheap, genuinely useful for the
   initial fill-in pass). ✅

## 10. Notes / decisions
- This is the first spec in the project that touches infrastructure (filesystem + driver
  abstraction). The discipline that applied to money/stock/cost applies here too: design
  for production from day one even though it runs locally today. The driver interface is
  the load-bearing piece — every other decision in this spec is reversible.
- ADR-012 to write alongside this spec: "Binary assets live outside MongoDB, behind a
  driver interface, with local-disk for dev and object-storage for prod." Frame it in
  the ADR-009/010/011 voice — the rule, the rationale (bloat / backup / multi-instance),
  the extension point (the driver interface itself is the extension point; swapping
  implementations is a config change).
- The "stripe of three surfaces" — Inventory, POS picker, Reports — is the right minimum.
  Resist the urge to add thumbnails everywhere they "could fit." Money screens stay
  text-only on purpose.
- Build order:
  1. Storage driver interface + LocalDiskDriver + S3Driver stub + tests for the local
     driver (put/delete/urlFor).
  2. Item.image field + Zod validation (createItem, updateItem) + the new image sub-routes
     (POST upload with **multer** for multipart + **Sharp** for resize, DELETE remove, plus
     URL set via existing PATCH) — both deps installed in this step so the upload route is
     functional end-to-end when its tests are written.
  3. Sharp resize pipeline + the `GET /api/static/items/:key` route + reject-too-large /
     wrong-type tests.
  4. CSV import: `imageUrl` column support (HEADERS extension + `normalizeRow` block using a
     new shared `httpUrl` validator — small addition to the existing validator).
  5. PAUSE on green. Verify backend slice by uploading via curl / a temporary test page.
  6. Frontend: ItemImage component (handles upload | url | placeholder | hover-preview)
     as a single reusable component. Then wire into Inventory list, POS picker, Reports.
  7. Browser-verify each surface in the order above. Pause for owner confirmation between
     surfaces (especially the hover-preview interaction — that's the most "feel"-driven
     piece of the spec).
- After ship: ADR-012 written, PROJECT_PLAN.md updated to mark 006b shipped, CLAUDE.md
  status updated. The next thing is genuinely Phase 7 (AI) — there will not be any more
  polish slices unless real-shop usage surfaces a need.