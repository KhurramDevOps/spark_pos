# Decisions Log

Short, append-only record of architectural decisions. One entry per decision. Newest on top.

Format:

```
## ADR-NNN — <title>
- Date:
- Status: accepted | superseded by ADR-MMM
- Context: what forced a choice
- Decision: what we chose
- Consequences: trade-offs, what this rules out
```

---

## ADR-016 — "Quick Sale" lines: revenue without a cost basis, structurally separated from COGS profit
- Date: 2026-06-27
- Status: accepted
- Context: The shop sells tiny, high-count, low-value goods (screws, lugs, connectors) not worth
  cataloguing as Items. A worker must be able to ring these up by typing a name + price at
  checkout. Such a line carries **real revenue but no cost basis** — no avgCost, no purchase
  history. The hazard is the exact shape of the 006c bug: an unknown cost silently treated as 0,
  which would make profit = full revenue and overstate it ~100%. (Spec 008.)
- Decision:
  - A `Sale.lines[]` entry gains a `kind` discriminator: `"item"` (default — unchanged, carries
    `itemId` + `costAtTime` + `suggestedPrice`) or `"quick"` (carries `name` + `qty` + `unitPrice`
    + `lineTotal`). A quick line **deliberately has NO `costAtTime` and NO `itemId` field at all** —
    absence, not zero. Absence forces every profit computation to branch on `kind` rather than read
    a 0. Backward compatible: existing lines default to `"item"` with all fields intact; no
    migration.
  - Quick lines have **no stock effect**: `recordSale` writes no `sale` StockMovement and touches
    no `Item.stock` for them; void restores stock for item lines only.
  - **Revenue includes quick lines** (`Sale.total`, `cashSales` → Daily Close "Expected cash in
    drawer", Reports revenue) — it is real cash, and the cash/drawer math needs no change because
    it already sums `Sale.total`.
  - **Every gross-profit computation skips `kind !== "item"` lines** (the two loops in
    `dailyCloseService` and `reportsService`). Quick-sale profit is *unknown* and is never formed,
    never defaulted to 0, never shown as a per-item performance row. The profit-based "Net for the
    day" (`grossProfit − expenses`) therefore also excludes quick sales — it is NOT the cash figure
    and must not be conflated with "Expected cash in drawer".
  - Quick-sale revenue is surfaced as its **own explicit figure** ("Quick-sale revenue (cost
    untracked)") on Daily Close and Reports, and as a single synthetic "Quick sales (uncatalogued)"
    row in Item Performance with profit shown as "—", so the revenue-vs-profit gap is visible, not
    mysterious.
  - **No StockMovement-equivalent and no new ledger.** Quick lines have no stock/avgCost to replay;
    the immutable `Sale` record (`name + qty + unitPrice + lineTotal`, `createdBy + date`) is the
    complete audit trail, and the cash side is captured by aggregate-on-read (ADR-011).
  - Permissions (v1): workers may create quick sales like any sale (no toggle). Reversal (v1):
    whole-sale void only (reverses cash/khata, no stock); partial per-line quick returns deferred
    until proven needed (the return flow is itemId + stock keyed).
- Consequences: sales become heterogeneous — a small `kind` branch in `recordSale`, `voidSale`, and
  the two profit loops. Margin on a quick-heavy day reads *low* unless the separate quick-revenue
  figure is read alongside, which is honest and the reason that figure is mandatory. Builds on the
  cost-integrity stance of ADR-013; same principle: never let an unknown cost masquerade as a known
  one. Supersedes nothing; the Sale-line shape from spec 004 is extended, not replaced.

## ADR-015 — Every deployed endpoint requires auth except a closed, enumerated public list
- Date: 2026-06-25
- Status: accepted
- Context: Phase 8 (spec 007) puts the app on a public URL. Before it, "the person at the
  keyboard is the owner" was a safe assumption; on the internet it is not. The failure mode
  that matters most is not a wrong permission on one route — it is a route that ships with NO
  auth at all (a new endpoint added later, a router file someone forgot to guard). That is a
  silent data breach, not a visible bug. This ADR fixes the invariant so it can't erode.
- Decision:
  - **Default-deny: every endpoint requires `requireAuth`, and owner-gated ones additionally
    `requireOwner`.** The exceptions are a CLOSED, ENUMERATED list — bootstrap (`GET`/`POST
    /bootstrap`), login (`POST /api/auth/login`), and exactly two public reads:
    **`GET /api/health`** (monitoring / pre-bootstrap probe) and **`GET /api/static/items/:key`**
    (public product-image bytes, ADR-012). Nothing else is exempt.
  - **The exempt list is also exempt from the empty-DB 503 gate and the 401→/login redirect**,
    so health checks and images work before bootstrap and without a session.
  - **Adding to the exempt list requires a new ADR.** It is not a code-review judgement call.
  - **The guard map is asserted by a test, not by reading code.** An enumerated guard test
    lists every route in every router file with its expected middleware and asserts the actual
    mounted stack matches — a new unguarded route fails CI. (Spec 007 §10 step 7.)
  - **Mixed-access router files use per-route middleware, not file-level `router.use`.**
    `items`, `sales`, `customers` mix auth-only and owner-only routes; only the uniformly-owner
    files (`imports`, `purchases`, `suppliers`, `expenses`, `drawer-adjustments`, `daily-close`,
    `reports`) may guard at the file level.
- Consequences: no endpoint can be deployed unauthenticated by accident; the one-line cost is
  that genuinely-public routes must be named here and in the test. Future specs inherit the
  invariant — any new route is auth-required until explicitly and deliberately exempted.

## ADR-014 — Auth: session cookies + bcrypt, with per-request revocation and a fixed role matrix
- Date: 2026-06-25
- Status: accepted
- Context: Spec 007 needs real authentication before deployment: a User model, password
  hashing, sessions, and two roles replacing the placeholder `currentUser` middleware that
  hard-codes every request as an owner. Crypto correctness and clean revocation matter more
  than feature breadth here — a hashing or session bug compromises every account.
- Decision:
  - **Passwords hashed with `bcrypt`, cost factor 12.** Never plaintext, never a fast hash,
    never homegrown. Compared via bcrypt's constant-time `compare`. Password max 72 bytes
    (bcrypt's limit) is enforced as validation, never silently truncated.
  - **Server-side sessions via `express-session` + `connect-mongo`** (not JWT). Cookie is
    HTTP-only, Secure (under `NODE_ENV=production`), SameSite=Strict, a non-default name, with
    a 12-hour TTL and sliding expiry. Logout destroys the session server-side.
  - **`requireAuth` re-checks `{ isActive, role }` on every request** (one lightweight lookup,
    those fields only). Deactivation, lockout, and role change therefore take effect on the
    user's NEXT request — no token blacklist, which is the main reason sessions were chosen
    over JWT. This per-request recheck is the spec's headline regression invariant.
  - **Roles stay `owner | worker` with the fixed §6 capability matrix.** Owners cannot create
    other owners; bootstrap is the only path to the first owner (created only while the `users`
    collection is empty). Login lockout is per-username (5 fails / 15 min → 15-min lockout,
    auto-expiring by timestamp), with identical message/timing for unknown-username vs
    wrong-password to avoid enumeration.
  - **Production is single-origin**: Express serves the built frontend (`express.static` +
    SPA fallback), so SameSite=Strict cookies work with no CORS. The Vite proxy is dev-only.
- Consequences: revocation is clean and immediate without extra infrastructure; the cost is a
  session store (a `sessions` collection) and one small DB read per authenticated request —
  acceptable at this shop's traffic. No plaintext password is logged, stored, or echoed
  anywhere (reviewed in code + asserted by a log-intercept test). A future third role, 2FA, or
  email reset is a new spec, not a tweak here.

## ADR-013 — Opening stock is a first-class inventory declaration, not a kind of purchase
- Date: 2026-06-24
- Status: accepted
- Context: The shop has ~200 items it already owns, paid for long ago, with no receipts but
  known per-unit costs. The app only let stock enter via a Purchase, so the workaround was
  entering items at cost = 0 and "fixing later" — which corrupts avgCost via weighted-average
  dilution (15 @ 0 then a real 15 @ 250 → avgCost 125, half the truth) and lies in every
  downstream profit number. Forcing existing inventory through Purchase also invents fake
  supplier debt and fake dates. (Spec 006c.)
- Decision:
  - **Declaring existing inventory is its own operation, modeled as a new
    `StockMovement.type = 'opening'`** — not a Purchase. Opening creates NO Supplier, moves no
    `Supplier.balance`, appears in no supplier ledger, and has no cash/daily-close impact. It
    is a pure inventory + cost declaration.
  - **For avgCost replay, `opening` is cost-bearing, treated identically to `purchase`.** The
    replay's recompute trigger is the set `{purchase, opening}`; the math (`applyPurchaseToCost`)
    is reused verbatim. An opening with a missing/negative cost is rejected by the same guard
    purchases use — never silently treated as 0.
  - **Cost storage is unified: the persisted opening cost lives in `StockMovement.costAtTime`,
    the same field purchases use.** There is no separate opening-cost field. The conceptual
    distinction (opening vs purchase) is the `type` enum value alone.
  - **Exactly one opening per item, immutable, repair-only via delete+replace.** The owner-only
    repair tool deletes any prior opening AND any legacy `adjustment`-noted-`"opening stock"`
    movement (the cost-less shape the old `createItem` produced), creates the corrected opening
    ordered before all remaining movements (`createdAt = min − 1ms`), and re-runs the pure
    replay — all in one transaction.
  - **MIGRATION is manual and owner-driven, not automatic.** Items already in the live DB
    carrying the old cost-less `adjustment`-noted-`"opening stock"` shape are NOT bulk-converted
    on deploy. Each is repaired individually, on demand, via the owner-only repair tool when the
    owner notices a wrong avgCost (the Edit-Item panel surfaces the legacy shape as "needs
    repair" so they're findable). There is deliberately no bulk migration — the shop has only a
    handful of such items, and the real ~200-item import goes through the CSV path fresh.
  - **EXTENSION POINT (future-me):** if a real need arises for "batch openings" (different
    costs per batch of the same item), that is a NEW spec (a multi-line opening or a genuine
    Purchase pattern), not a tweak here. One opening, one qty, one cost per item stands.
- Consequences: existing inventory enters with correct avgCost from day one, no fake suppliers
  or debt; the replay engine gains one cost-bearing type and no new cost code path; corrupt
  legacy data is fixable in place. The one subtlety that demanded careful review — a repair
  stacking a new opening on top of the legacy cost-less adjustment and double-counting stock —
  is handled by deleting the legacy shape inside the repair transaction.

## ADR-012 — Binary assets live outside MongoDB, behind a storage-driver interface
- Date: 2026-06-23
- Status: accepted
- Context: Spec 006b adds the project's first binary content (product images). The question is
  where the bytes live and how the code that handles them survives the move from local-dev to
  a real deployment (which may have ephemeral or per-instance disk).
- Decision:
  - **Image (and any future binary) bytes never go in MongoDB.** Not as Base64, not in GridFS.
    MongoDB stores only a **reference string** — `Item.image.ref` is a storage key (uploads) or
    an external URL. The bytes live on a filesystem (local disk now) or object storage (S3/R2,
    prod).
  - **All binary I/O goes through a tiny storage-driver interface** — `put(buffer, keyHint) →
    key`, `delete(key)`, `urlFor(key) → string` — with `LocalDiskDriver` (writes
    `backend/uploads/items/`, served at `GET /api/static/items/:key`) and a stub `S3Driver`
    (throws "not implemented" until deploy). The driver is selected by the `STORAGE_DRIVER` env
    var. The `Item.image` shape is identical regardless of driver.
  - **Why:** binary blobs in MongoDB bloat the working set (every query touching Item drags the
    bytes around), turn `mongodump`/restore into a slow file transfer, and don't shard sensibly.
    A reference + external store is the industry-standard split. The driver interface exists
    because hard-coding `fs.writeFile('./uploads/...')` breaks on day one of a deployment where
    disk is ephemeral or per-instance — the code must not assume a local filesystem.
  - **EXTENSION POINT (future-me):** the driver interface IS the extension point. Going to
    production object storage is implementing `S3Driver` against the same three methods and
    flipping `STORAGE_DRIVER=s3` — a config change, not a rewrite of the upload pipeline. No
    caller knows or cares which driver is active.
- Consequences: lean Mongo documents and fast backups; one swap-point for prod storage; a small
  amount of upfront abstraction (three methods + two impls) that pays for itself the first time
  this deploys. Reading images is public (`/api/static/...`, no auth); writing is owner-gated.

## ADR-011 — Aggregate on read; never denormalize derived totals
- Date: 2026-06-23
- Status: accepted
- Context: Three specs in a row have computed reporting numbers by reading immutable source
  rows at query time rather than maintaining a stored running total: 004b's returns indicator
  on Sale History, 005's daily-close cash math + gross profit, and now 006's reports (headline
  tiles, trend, item performance, expense breakdown). Each was argued case-by-case; the pattern
  is now consistent enough to make an explicit rule so future specs don't re-litigate it.
- Decision:
  - **Derived totals are computed on read from immutable source collections (Sale, CustomerReturn,
    Expense, payments, Item), never stored as a denormalized aggregate.** Profit, revenue, daily
    cash math, per-item performance, balances-for-display — all recomputed from the source rows
    each time. The source rows are the single point of truth; there is no second copy to drift.
  - **Why:** denormalized totals are the classic correctness hazard — they drift the moment any
    contributing row is voided/returned/edited and a recompute is missed. Aggregate-on-read can
    never drift because there is nothing to keep in sync. At this shop's volume (low traffic,
    hundreds of sales/month) the read cost is trivially fast, so the safety is free.
  - **What this does NOT cover:** the few *physical-fact* snapshots that legitimately must be
    stored because they cannot be re-derived — `Sale.lines.costAtTime` (the avgCost at sale
    instant), `DayClose.actualCash` (what was physically counted). Those are inputs, not derived
    aggregates, and stay stored (see ADR-008, ADR-009). The cached `Customer.balance` /
    `Supplier.balance` are a deliberate, transaction-maintained exception (updated inside the
    same write that moves the ledger) — reports may *read* them but must not recompute and
    re-store them.
  - **EXTENSION POINT (future-me, read this):** if a report ever measures too slow on a real
    range with real data, the fix is, in order: (1) add the compound index the query needs
    (e.g. `(createdAt, voided)` on Sale) — see spec 006 §5; (2) only if indexing is insufficient,
    introduce a denormalized cache **behind a measured benchmark**, with a documented recompute
    path and a test proving it matches the aggregate-on-read result. **Never denormalize
    pre-emptively or by gut feel — only after measurement shows a real problem.**
- Consequences: zero drift risk for all derived reporting; trivially correct; slightly more
  query work per read (negligible at this volume). The seam for a future cache is explicit and
  gated on measurement, so the default stays safe.

## ADR-010 — Daily-close aggregation buckets by `createdAt` in Asia/Karachi, not by `date`
- Date: 2026-06-23
- Status: accepted
- Context: Spec 005's daily close must put each cash flow in the right shop-day. The existing
  `listSales`/`listPurchases` filter by the user-editable **`date`** field (a label, can be
  back/future-dated); there is no timezone handling anywhere in the codebase today.
- Decision:
  - **Bucket by `createdAt` (immutable insertion instant), NOT the `date` label.** Cash moved
    when the row was written, not when a user-edited label says. This is a DELIBERATE divergence
    from the existing `date`-based list filters — written here so it is not mistaken for an
    inconsistency to "fix."
  - **"Day" = Asia/Karachi 00:00–23:59:59.999.** Pakistan is UTC+5 with **no DST (ever)**, so a
    fixed constant `ASIA_KARACHI_OFFSET_MIN = 300` is exact — Karachi midnight = UTC 19:00 the
    prior day. The aggregation computes the Karachi-day window as UTC instants and queries
    `createdAt ∈ [start, end]`. **No timezone dependency** is added. (Comment: revisit only if
    Pakistan ever adopts DST.)
  - The aggregation service is **parameterized by `[start, end]`** so Phase 6 can reuse it for
    week/month windows.
- Consequences: correct shop-day bucketing independent of any edited date label, dependency-free.
  The existing `date`-based list endpoints are left as-is (different purpose: browsing/filtering,
  not cash accounting).

## ADR-009 — Daily close: all payments are CURRENTLY cash (no method field yet); expenses stay separate from per-sale profit
- Date: 2026-06-23
- Status: accepted
- Context: Spec 005's cash math sums "cash" customer/supplier payments. Verified against the
  as-built models: `CustomerPayment` and `SupplierPayment` are `{ entityId, amount, date, note,
  createdBy }` — **there is no `method`/`isCash` field**, and no UI to set one.
- Decision:
  - **Treat every `CustomerPayment` and `SupplierPayment` as cash in the daily-close math.** This
    is true because the model has **no method field** — not because we've decided cash is the only
    payment type forever. Every payment in the system today IS cash in practice.
  - **EXTENSION POINT (future-me, read this):** when a non-cash payment path ships (its own
    spec — e.g. bank transfer / cheque on a khata payment), it will add a `method` field to
    `CustomerPayment`/`SupplierPayment`, and **the daily-close aggregation MUST then add
    `method: 'cash'` filters** to the supplier- and customer-payment sums (lines E and B of spec
    005 §6). Until that field exists, no filter is possible or needed.
  - **Expenses stay separate from per-sale profit.** Per-sale gross profit (Σ (unitPrice −
    costAtTime)×qty) is unchanged and NOT reduced by expenses. "Net for the day" = gross profit −
    expenses is a daily-level DISPLAY-only derivation, stored nowhere — folding expenses into
    `Sale.profit` would muddy the per-sale numbers kept honest since spec 004.
  - **Carry-forward is physical, not computed:** next day's starting cash = this day's
    `DayClose.actualCash` (what was physically counted that night). A retroactive void/return that
    shifts a past day's *expected* cash does NOT change its `actualCash` — so the carry-forward
    stays correct even when the close is flagged stale. Stale re-save updates the
    expected/difference snapshot only.
- Consequences: simple, currently-accurate cash math with a clearly-marked seam for non-cash
  payments later. Daily net is a view, not a stored field; per-sale profit stays clean.

## ADR-008 — Sale void & customer returns: stock-only reversal, no replay
- Date: 2026-06-23
- Status: accepted
- Context: Spec 004b adds the sell-side recovery net (void a sale, record a customer return),
  mirroring 003b's purchase-side reversals. The central question was whether sale reversal needs
  003b's avgCost replay engine.
- Decision:
  - **No replay — sale void/return is stock-only.** Verified against the code: `saleService`
    never writes `item.avgCost` (it only reads it to snapshot `costAtTime`), and
    `recomputeItemCostByReplay` recomputes avg ONLY at `type === "purchase"` movements (every
    other type is qty-only). So undoing a sale is just: add stock back + undo the cash/khata
    effect. The 003b replay/exclusion machinery is deliberately NOT reused.
  - **`reversalRef` left UNSET on sale-side reversing movements.** That field is replay's
    purchase-cost exclusion trigger; it has no meaning for sales. Sale void uses `type:"reversal"`,
    customer return uses `type:"return"` (both POSITIVE qty, mirroring 003b's reversal-vs-return
    distinction), each with `refId = sale._id` and `reversalRef` unset. The original −q sale
    movement and the new +q movement are both qty-only and cancel, so `recalculate-cost` still
    reports no drift.
  - **Returns require a linked sale** (`CustomerReturn.saleId` required) — gives the qty cap, the
    original `unitPrice` as refund value, and a clean audit trail; standalone returns rejected.
  - **Refund method = cash | khata-credit.** cash = record only, no balance/customer needed;
    khata-credit REQUIRES a customer and does `customer.balance -= total` (may go negative = store
    credit, surfaced). `customerId` is conditionally required (iff khata-credit).
  - **Cumulative return-qty cap:** this return's qty + all prior returns on the same sale line
    must not exceed the sold qty.
  - **Void/return immutable + audited:** `Sale.voided/voidedAt/voidedBy`; rows never deleted;
    voiding an already-voided sale rejected. Profit reversal is just marking voided + storing the
    return (saleId + per-line qty) so a future Phase-6 report nets it out — no profit math now.
  - **CustomerReturn mirrors SupplierReturn structurally (~80%), NOT its replay:** same model/
    validation/service skeleton/UI pattern; diverges on positive qty (stock IN), no replay,
    refund-method branch, and the cap query.
- Consequences: a small, fast, correct sell-side reversal with one transaction per op and the
  same balance/immutability conventions as every prior spec. After this ships, the sell side is
  recoverable in-app like the purchase side became after 003b.

## ADR-007 — Sales / POS: profit by cost snapshot, per-line discount, immutable sales
- Date: 2026-06-22
- Status: accepted
- Context: Phase 3 (spec 004) records sales and makes profit real for the first time by
  consuming avgCost. Several choices here are expensive to unwind once real sales exist
  (profit history, khata balances), so they are pinned before building.
- Decision:
  - **Profit = (unitPrice − costAtTime) × qty, with `costAtTime` snapshotted per line.** The
    sale reads `item.avgCost` INSIDE its transaction and stores it on the line; it is never
    recomputed. Profit reporting is then summing stored numbers — no drift. A sale **does not
    change avgCost** (selling doesn't change what remaining stock cost); it only decrements
    stockQty and snapshots cost. Mirrors 003b's "return removes at current avg, avg unchanged".
  - **Replay is unchanged for sales (verified, zero engine change).** The 003b replay/
    recalculate-cost engine branches on `type === "purchase"` vs everything-else (qty-only), and
    `sale` is already in the StockMovement enum (since spec 001). So `sale` movements move only
    running quantity in replay and never perturb avgCost. Locked in by a regression test. NO
    schema/enum migration.
  - **Per-line discount only; no sale-level discount.** Bargaining is the per-line `unitPrice`
    override; the server also snapshots `suggestedPrice` for honest discount reporting. A
    sale-level discount would force arbitrary allocation across lines to compute per-line profit
    — rejected. `Sale.discount` is NOT modeled.
  - **suggestedPrice is server-derived:** `priceMode === "wholesale" ? (wholesalePrice ??
    retailPrice) : retailPrice` — never suggest 0 in wholesale mode when wholesale is unset.
    Client-sent suggested/cost values are ignored (snapshotted server-side, like purchases read
    state in-txn).
  - **Sales are immutable** (like Purchase). Corrections are via **004b** (customer return / sale
    void) + re-enter — one coherent reversal model, deferred to keep the core sell flow
    shippable. NOTE: a sale return/void only restores **stock** (qty-only reversing movement); it
    must NOT reuse the purchase-reversal cost-exclusion replay, because a sale never changed avg.
  - **Customer mirrors Supplier; CustomerPayment mirrors SupplierPayment.** Credit sale →
    `customer.balance += total`; payment → `balance −= amount` (own txn); balance may go negative
    (advance = shop owes the customer), surfaced not blocked. No forked patterns.
  - **Negative-stock sell-through** governed by the existing `Settings.allowNegativeInventory`
    (read in-txn via `getSingleton(session)`, default true → never blocks). When false, reject a
    sale that would drive an item negative, checked on the **summed** qty across duplicate lines.
  - **unitPrice ≥ 0 (0 allowed)**; below-cost (`unitPrice < costAtTime`) is **derived**, advisory,
    never stored, never blocking. **Two `costAtTime` copies** (sale line + sale movement): the
    line is the source of truth for profit; the movement is audit symmetry only.
  - **Negative Stock view** (deferred from spec 001) is built in spec 004, since sales are what
    create negative stock.
- Consequences: profit is auditable and drift-free (summed snapshots). One reversal model lands
  in 004b rather than two half-models now. Heavy reuse of the Supplier/payment/transaction
  machinery keeps the new surface small (the genuinely new code is the Sale model + sale service
  + the POS screen). Until 004b ships, a mis-keyed sale is only fixable by DB restore (same gap
  003 had pre-003b) — mitigated by shipping 004b immediately after.

## ADR-006 — Purchase reversals & returns: avgCost repair by full-history replay
- Date: 2026-06-22
- Status: accepted
- Context: Spec 003b adds purchase reversal and supplier returns. Both must correct the cached
  aggregates (`stockQty`, `avgCost`, `supplier.balance`), not just delete rows. ADR-005 already
  established that avgCost is path-dependent and cannot be losslessly un-averaged, naming
  replay-from-`costAtTime` as the true repair path. This ADR fixes the exact replay semantics —
  an early spec draft got them wrong ("walk purchase + return movements only"), which would
  miscompute avgCost the moment any non-purchase movement (opening stock, adjustment, sale) sits
  between purchases.
- Decision:
  - **Replay walks ALL movement types in posting order; recomputes the average ONLY at
    `purchase` events.** Maintain a running `(stockQty, avgCost)` from `(0,0)`; at a `purchase`
    movement apply the spec 003 §6 floored-weighted-average (`applyPurchaseToCost`); at every
    other type (`adjustment`/opening, `sale`, `return`, `reversal`) apply the signed qty to
    running stock and leave avgCost unchanged. Rationale: the incremental engine computed each
    purchase's average from the *live* stockQty, which already reflects opening/adjustments/sales
    (the canonical 200@₹0 opening is an `adjustment`; `100@₹10 → adjust −60 → 100@₹20` = ₹17.14,
    not the purchase-only ₹15.00).
  - **Ordering key = `(createdAt asc, _id asc)`, never `purchase.date`.** `date` is a label
    (ADR-005); `_id` is the tiebreak for same-`createdAt` rows (e.g. two same-item lines of one
    purchase written in one ordered bulk insert). `StockMovement` has no `date` field, so replay
    structurally cannot order by the purchase label.
  - **Reversal = exclude, don't subtract.** To reverse purchase `P`, replay each affected item
    excluding every movement with `refId === P._id` OR `reversalRef === P._id` (the original rows
    and their reversing pair cancel and are both dropped), and recompute from survivors. Never
    feed a negative qty into the average formula.
  - **Returns do not change avgCost at return time.** Under weighted-average, returned units
    leave at the current average; only running qty drops (future-correct via replay). The
    `return` movement stores `costAtTime = current avgCost` for valuation symmetry.
  - **One avgCost code path:** the replay service reuses `applyPurchaseToCost` verbatim (scale 10,
    half-even). No second formula.
  - **costAtTime guard:** replay throws if a consumed `purchase` movement lacks a non-negative
    `costAtTime` (corruption surfaced, never treated as 0).
  - **Drift detector:** replay returns a recomputed `stockQty`; callers/repair-tool compare it to
    the cached value.
  - **Shapes:** distinct **`reversal`** StockMovement type (separate from `return`); new
    `StockMovement.reversalRef`; compound index `{ itemId:1, createdAt:1, _id:1 }`; separate
    **`SupplierReturn`** collection; already-paid reversal/return drives `supplier.balance`
    negative ("advance / refund due") + surfaced; returns may drive stock negative (allowed +
    surfaced); replay exposed as an owner-only "recalculate cost" repair tool.
- Consequences: One reusable, tested replay engine underpins reverse, return, and repair — no
  divergent cost math. Replay cost is O(movements for the affected item), bounded by the new
  index; fine for this shop's volume. Append-only ledger stays honest (nothing deleted; reversed
  rows retained and filtered). The "walk all types" rule is mandatory for correctness once sales
  ship in Phase 3.

## ADR-005 — Purchases & weighted-average cost: precision, immutability, paisa rules
- Date: 2026-06-22
- Status: accepted
- Context: Phase 2 (spec 003) records stock-in and makes `Item.avgCost` a real moving number via
  weighted-average. The cost math, its precision, and the (im)mutability of purchases are
  expensive to change once real cost history exists — Phase 3 reads avgCost for COGS.
- Decision:
  - **avgCost = weighted-average, fixed scale 10 fractional digits of paisa, round-half-even.**
    Division (`17000/150 = 113.333…`) can't be exact, so avgCost is kept to 10 fractional paisa
    digits with banker's rounding — NOT whole-paisa (rounding cost every purchase is the COGS
    drift PROJECT_PLAN §4.1 warns about). Exact `add`/`multiply` and `divide(a,b,scale,rounding)`
    are implemented with BigInt in `lib/decimal.js`; no decimal library, no floats.
  - **oldQty floored at 0 in BOTH numerator and denominator of the average:**
    `effectiveOld = max(oldQty,0)`; `newAvg = (effectiveOld·oldAvg + qty·unitCost) / (effectiveOld
    + qty)`; `stockQty = oldQty + qty` (real, may stay negative). Flooring stops negative stock
    corrupting cost AND removes divide-by-zero (the divisor is always ≥ qty > 0). effectiveOld = 0
    ⇒ avg = unitCost.
  - **Paisa rules (two separate ones):** `unitCost`/`avgCost`/`lineTotal` are **Decimal128 paisa**
    (cost basis, full precision); the purchase **`total` / supplier payable is WHOLE paisa**
    (real money owed). unitCost entered in rupees (≤2dp, `0` allowed) via a **shared money
    validator lifted from spec 002** (one rupee→paisa rule for import + purchases). Totals are
    computed server-side; client-sent totals are ignored.
  - **Posted purchases are immutable.** avgCost is path-dependent (applied in **posting order**,
    not the `date` field — backdating does not reorder cost history), so editing can't cleanly
    recompute history. Mistakes are fixed by a reversing entry (**spec 003b, built next**).
    Caveat: a reversal fixes stock/payables exactly but **cannot losslessly restore avgCost** —
    you can't un-average. The true repair path is **replay-from-`costAtTime`**, which is why every
    purchase StockMovement stores `costAtTime` (the unit cost paid).
  - **One transaction per purchase**, reading item state inside the txn; lines processed
    sequentially (duplicate item across lines builds on the running value); credit purchases
    update `supplier.balance` in the same txn; supplier balance may go negative (advance).
- Consequences: avgCost carries up to 10 fractional paisa digits (negligible storage, near-zero
  drift over thousands of purchases). Immutability means a returns/reversal spec (003b) is
  effectively mandatory and must ship before heavy real use; until then mongodump is the
  safeguard. Cost basis and money-owed diverge by sub-paisa on fractional-qty purchases — by
  design (you can't owe a fraction of a paisa, but cost must stay precise).

## ADR-004 — CSV bulk import: insert-only, two-phase with a server stash, locked headers
- Date: 2026-06-20
- Status: accepted
- Context: Spec 002 adds bulk item import from a spreadsheet — the main bottleneck to cataloguing
  the real shop. Several choices here are expensive to reverse once owners have prepared files
  and run imports against a live catalogue.
- Decision:
  - **CSV only**, parsed server-side with **papaparse** (the one approved new dependency). The
    browser POSTs the file's raw text as a `text/csv` body — **no multipart upload library**
    (e.g. multer). `.xlsx`/SheetJS deferred.
  - **Insert-only.** A row whose SKU already exists (active or inactive) is an error/skip, never
    an update. Update-on-collision is a one-way door (workflows would come to depend on it); an
    opt-in update mode with a per-field-diff preview can be added later without breaking anyone.
  - **Two-phase preview → commit via a short-lived in-memory server stash keyed by a random
    import token (+ TTL).** Commit sends only the token; the server re-reads and re-validates the
    stashed upload — it never trusts a client-echoed preview. The durable audit record is the
    `ImportLog`, not the stash.
  - **Preview never writes and never burns the SKU counter.** Auto-SKUs are generated (atomic
    per-prefix counter, ADR per spec 001 §9.2) **only at commit**; preview shows `(auto)`. A test
    asserts the `Counter` collection is unchanged after a preview. (Burning numbers in preview
    would leave permanent gaps and make previewed SKUs mismatch committed ones.)
  - **Locked template headers** (exact strings): `name, categoryName, baseUnit, retailPrice,
    wholesalePrice, reorderLevel, openingStock, sku`. Required: the first four. Matching is
    case-insensitive/trimmed with a leading BOM stripped. Renaming them breaks owners' saved
    files, so they are fixed.
  - **New `ImportLog` collection** (filename, createdBy, counts, error report, timestamp), one
    document per commit — the only audit trail for an operation with no per-item undo.
  - Categories referenced by name are auto-created **up front** (before any row transaction),
    deduped case-insensitively including within the file; prefix via existing `deriveSkuPrefix()`
    with no special collision handling. Money: rupees→paisa (`×100`), **reject >2 decimal places
    and any separators/symbols** (never round money). Cap **10,000 rows / 10 MB**. Commit is a
    loop of per-row transactions over the existing `createItem()` service. Import is **owner-only**.
- Consequences: Simpler, safer first version (pure inserts, no merge semantics, no interaction
  with `baseUnit` immutability). The stash makes the server briefly stateful between the two
  calls (bounded by TTL + size cap; lost on restart → owner re-uploads). Per-row transactions
  cost throughput but keep each row atomic and reuse tested code. Adding update mode or `.xlsx`
  later is additive.

## ADR-003 — MongoDB runs as a replica set (transactions); decimal precision split
- Date: 2026-06-20
- Status: accepted
- Context: Golden rule #3 requires multi-document transactions
  (`session.withTransaction`) for any write spanning stock + ledger + COGS. MongoDB only
  supports transactions on a **replica set** (or mongos) — a standalone `mongod` throws. Spec
  001 also moved quantities to Decimal128 (wire/cable/copper sell in fractional gaz/meter/kg).
- Decision:
  - **Run MongoDB as a replica set in every environment.** Local dev = a single-node set `rs0`
    (`replSetName: rs0` in `mongod.conf`, one-time `rs.initiate()` — automated via
    `backend/src/scripts/initReplicaSet.js`, i.e. `npm run rs:init`). Tests connect to `rs0`.
    Production = MongoDB Atlas (always a replica set). Steps documented in `backend/README.md`.
  - **Money/precision split:** retail/wholesale prices stay integer **paisa**; `avgCost`,
    `costAtTime`, and all **quantities** (`stockQty`, StockMovement `qty`) are **Decimal128**.
    The small bit of quantity arithmetic (adjustment delta) uses an exact BigInt helper
    (`backend/src/lib/decimal.js`) rather than adding a decimal-math dependency. No floats.
- Consequences: Local setup has one extra one-time step (initiate the set) — scripted, so it's
  cheap. Tests require a running replica set. Decimal128 over JSON is transmitted as strings to
  avoid float coercion. Keeps transactions and exact money/stock math available from day one.

## ADR-002 — AI via Anthropic Messages API + tool use (not OpenAI, not Agent SDK yet)
- Date: <fill in>
- Status: accepted
- Context: Need a chatbot + conversational sales. Already using Claude Code / Anthropic.
- Decision: Use Claude (Anthropic). Start with the plain Messages API + tool-use loop with a
  small fixed set of tools. Defer the Claude Agent SDK unless workflows become open-ended.
- Consequences: Simpler, cheaper, easier to debug. One ecosystem. Re-evaluate if needs grow.

## ADR-001 — MERN stack (MongoDB, Express, React, Node), with disciplined transactions
- Date: <fill in>
- Status: accepted
- Context: Developer already knows MERN — shipping with a known stack beats a theoretically
  "purer" one. Inventory + accounting data is transactional: a sale must update stock, ledger,
  and COGS together or not at all.
- Decision: MongoDB + Mongoose. Every service function writing to more than one collection
  must use a MongoDB multi-document transaction (`mongoose.startSession()` +
  `withTransaction`). This rule is non-negotiable and is enforced in code review / spec
  acceptance criteria, not left to convention.
- Consequences: Faster initial development (familiar stack). Slightly more manual discipline
  required than a relational DB with built-in ACID guarantees — the transaction rule exists
  specifically to close that gap. TypeScript + Zod added to catch the bugs Mongo's flexible
  schema would otherwise let through.