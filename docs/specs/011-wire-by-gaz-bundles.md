# Spec: 011 — Wire sold by the gaz, bought by the (90-gaz) bundle

> Slice 7 of the June-2026 batch — the big one. Full spec + ADR first (new inventory
> architecture, same weight as opening-stock / ADR-013). No code until reviewed.

- **Status:** done (shipped 2026-06-28) — ADR-019
- **Phase:** post-Phase-6 enhancement
- **Author / date:** Claude Code / 2026-06-28

## 1. Problem / goal

Wire/cable is **bought in sealed bundles** but **sold by the gaz** (a fractional length).
Every bundle is **exactly 90 gaz** — a fixed, universal constant of the trade, not a
per-item setting. Today an item has one base unit and one price; there's no way to say
"I paid Rs X per *bundle* but I sell by the *gaz*", and no way to see stock as
"3 bundles + 40 gaz". The owner needs correct per-gaz COGS from bundle-priced purchases,
and a stock/price display that speaks both bundles and gaz.

## 2. User stories

- As the owner, I want to mark a wire item as **sold by the gaz, bought by the bundle**,
  so the app handles the 90× conversion for me.
- As the owner, when I **buy** wire, I want to enter **bundles + price per bundle**, and
  have the system store the right per-gaz cost so my profit per gaz is correct.
- As the owner, when I **sell** wire, I want to enter the length **in gaz** (e.g. 7.5)
  and have stock and profit update correctly.
- As the owner, I want to **see stock as bundles + loose gaz** (e.g. "3 bundles + 40 gaz")
  everywhere it matters, because that's how I think about my shelf.

## 3. Scope

**In scope:**
- A per-item **`bundle` flag** (boolean) on gaz items: "bought by the 90-gaz bundle".
- A single fixed constant **`BUNDLE_GAZ = 90`** (shared). NOT a per-item field.
- **Purchase + opening-stock entry in bundles + price-per-bundle**, converted at the
  entry boundary to canonical gaz qty + per-gaz cost.
- **Bundles + loose-gaz display** of stock wherever a bundle item's stock is shown
  (Inventory, POS picker, Sale/Reports where practical).
- A shared pure converter + tested.

**Out of scope (explicitly not now):**
- A per-item or per-bundle *variable* bundle size — **90 is a hard constant** (owner's
  explicit instruction). A different bundle size later is a NEW spec.
- Physically tracking **sealed bundles vs loose gaz** as separate quantities — we store
  **total gaz** and derive bundles+loose by ÷90 (owner's chosen model). There is no
  "open a bundle" event.
- Selling **by the bundle** (a sale is always in gaz; a bundle is a buy-side concept).
- Changing the avgCost/replay/COGS engines — they stay per-gaz and untouched.
- Retro-converting existing gaz items — flipping the flag is owner-driven, no migration.

## 4. UI / flow

**Item form:** a checkbox **"Bought by the bundle (90 gaz)"**, enabled only when
`baseUnit = "gaz"`. Retail price stays **per gaz** (you sell by the gaz); the form shows
the implied **per-bundle price (×90)** live as a read-only hint. **Wholesale price (Q6):
the existing optional `wholesalePrice` applies and is also per-gaz** — same field, same
behaviour as every item (the POS retail/wholesale toggle and `suggestedPriceFor` already
read it; for gaz items it is simply a per-gaz number), with the same ×90 per-bundle hint.
No new wholesale modelling — it works for free because it is already per-base-unit.
Toggling the bundle flag does not touch stock or cost.

**Per-gaz rate highlight (Q5 — the explicit "easy to read in a big inventory" ask):** for
bundle items the **per-gaz price is rendered in a distinct accent colour** (a coloured,
slightly emphasised "Rs X / gaz" chip) on the Inventory list and the POS picker, so the
selling rate scans instantly in a long list. Non-bundle items are unaffected.

**Purchase form (bundle item line):** the qty/cost inputs relabel to **"Bundles"** and
**"Price per bundle (Rs)"**. The owner enters e.g. `5` bundles at `Rs 900`. A live hint
shows "= 450 gaz, Rs 10.00/gaz". On submit the server converts to canonical gaz.

**Opening stock (bundle item, in the Item create form):** same — declare **bundles +
cost per bundle**; converted to gaz + per-gaz cost (ADR-013 path, unchanged otherwise).

**POS / sale:** unchanged entry — sell **in gaz** (qty `7.5`). The picker and the line
show remaining stock as **"3 bundles + 40 gaz"**. (Optional helper: type a gaz amount,
see how many bundles it is — nice-to-have, not required.)

**Inventory list / wherever stock shows:** a bundle item's stock renders as
**"3 bundles + 40 gaz" (= 310 gaz)**; a non-bundle gaz item still shows plain gaz.

**Unhappy paths:** flag on a non-gaz item → blocked (checkbox disabled / server reject).
Fractional bundles on purchase (e.g. 2.5) → allowed (×90 = 225 gaz). A sale that drives
gaz below zero is governed by the existing `allowNegativeInventory` setting (unchanged).

## 5. Data model changes

- **`Item.bundle`**: Boolean, default `false`. When `true`, `baseUnit` MUST be `"gaz"`
  (enforced in the service + Zod). Purely a behavior/display marker — **no new
  quantity or cost field**.
- **`BUNDLE_GAZ = 90`** lives in a shared constant (e.g. `shared/inventory/bundle.js`),
  imported by both ends. Hard-coded, no per-item override.
- **Nothing else changes.** `stockQty` stays canonical **total gaz** (Decimal128);
  `avgCost`/`costAtTime` stay **per-gaz** paisa (Decimal128, ADR-005 precision);
  `retailPrice` stays **per-gaz** integer paisa. StockMovements store canonical gaz qty
  + per-gaz cost — so replay/reversal/COGS are untouched.

### Existing data / migration (explicit — no silent reinterpretation)

- **The flag is FORWARD-ONLY and changes no stored number.** Setting `bundle = true` on an
  existing item does **not** multiply, divide, or otherwise touch its `stockQty`,
  `avgCost`, or `retailPrice`. It only changes (a) how the *next* purchase/opening is
  *entered* (bundles + price-per-bundle) and (b) how stock is *displayed* (÷90). A
  regression test asserts flipping the flag leaves stockQty/avgCost/retailPrice
  byte-identical.
- **Why this is safe for existing wire items:** a wire item entered the old way already
  has `baseUnit = "gaz"` and `stockQty` already **in gaz** (gaz has been a base unit since
  spec 001). Flagging it `bundle` therefore interprets the existing number as exactly what
  it already is — gaz — with **no reinterpretation**. "450" stays 450 gaz; it is now
  merely *shown* as "5 bundles". There is no unit change to get wrong.
- **The one hazard, named:** if an owner had mis-entered a wire item's stock as a *bundle
  count* (e.g. typed "5" meaning 5 bundles) into a plain gaz item, that number is wrong
  **today** (it means 5 gaz) — and flagging `bundle` will **not** silently "fix" it to 450.
  The flag never reinterprets. The remedy is the existing, owner-driven tools: a stock
  **adjustment** (spec 001) to set the real gaz count, and/or the **opening-cost repair**
  (ADR-013) — the same path used for any wrong opening. **There is no automatic
  bulk-conversion, by design.** If a wire item's stored stock is not actually gaz, the
  owner re-declares it cleanly; the flag alone is never trusted to repair data.
- **Non-gaz wire items** (e.g. one entered as `coil`) **cannot be flagged** (`bundle ⇒
  baseUnit === "gaz"`). `baseUnit` is itself locked once stock has moved (spec 001), so
  such an item must be re-declared as a gaz item to become a bundle item — again, an
  explicit owner action, never automatic.

## 6. Business rules (be precise — this is where bugs live)

- **Canonical unit is the gaz, always.** "Bundle" is a *data-entry + display convention*
  over a per-gaz base unit. Everything stored — stock, avgCost, costAtTime, retail,
  movements — is per gaz. This is the design's spine.
- **THE RETAIL-vs-COST ASYMMETRY (read this twice — it is the heart of the spec):**
  - **RETAIL is entered and stored PER GAZ, exact.** You sell by the gaz, so the per-gaz
    price is the real transactional number — the figure money actually changes hands at —
    and it must never be rounded. The owner types it directly; the per-bundle figure
    (`retailPerGaz × 90`) is a display-only, approximate convenience and is never stored.
    There is **no ÷90 on retail, ever, anywhere.**
  - **COST is divided ÷90 ONCE, at PURCHASE time.** Cost arrives as a *bundle* purchase at
    a *bundle* price. We convert to per-gaz cost **at the entry boundary** (`pricePerBundle
    ÷ 90`, full Decimal precision) so the **unchanged** weighted-average engine and the
    `costAtTime` snapshot already operate in per-gaz terms. **Cost is NEVER divided at sale
    time** — by the time a sale reads `avgCost`, it is already per-gaz. Dividing cost at
    sale time would be the bug; the whole design exists to avoid it.
  - One-line mnemonic: **retail in per-gaz (exact); cost in per-bundle → ÷90 at purchase →
    per-gaz thereafter.**
- **You BUY bundles, you SELL gaz (the asymmetry):**
  - **Purchase / opening conversion (server-side, at the entry boundary only):** for a
    bundle item the owner enters `bundles` + `pricePerBundle` (rupees, ≤2dp — a normal
    money value). The service converts **before** touching the cost engine:
    - `qtyGaz = bundles × 90` (exact — bundles is the only fractional input, ×90 is exact).
    - `unitCostPerGaz = divide(pricePerBundlePaisa, 90, AVG_COST_SCALE=10, HALF_EVEN)` —
      **stored as Decimal128 at the existing 10-fractional-paisa cost scale (ADR-005),
      NOT rounded to whole paisa.** Rounding cost to whole paisa would drift by up to ~0.5
      paisa × 90 per bundle — exactly the COGS drift the 10-digit scale exists to prevent.
      At scale 10 the value is exact for clean divisions (Rs 900 → 1000.0000000000 /gaz)
      and good to 1e-10 paisa otherwise; `90 × unitCostPerGaz` reconciles to the bundle
      price far below any monetary significance.
    - It then calls the **unchanged** `applyPurchaseToCost(oldQtyGaz, oldAvgPerGaz, qtyGaz,
      unitCostPerGaz)` and writes a normal per-gaz StockMovement (`qty = qtyGaz`,
      `costAtTime = unitCostPerGaz`).
    - **The supplier payable is computed from the EXACT bundle figures, decoupled from the
      rounded per-gaz cost:** `lineTotal = bundles × pricePerBundlePaisa` (then the purchase
      `total` rounds half-even to whole paisa, as today). This is the ADR-005 split —
      *money owed* is exact whole paisa; *cost basis* is full-precision per-gaz Decimal —
      so **no paisa leaks** into or out of what the supplier is owed, regardless of how the
      per-gaz cost divides.
  - **Sale (fractional gaz, sell-side rounding — golden rule #2):** entered in **gaz**,
    **fractional allowed** (5, 5.5, 7.25 gaz — `qty` is already a positive decimal /
    Decimal128, unchanged from spec 004). The line is computed exactly and rounded only at
    the payable boundary, **reusing the existing sale math unchanged**: `lineTotal =
    qty × unitPricePerGaz` kept at **full Decimal precision** (no rounding), and the sale's
    payable `total = round(Σ lineTotal, 0, HALF_EVEN)` — **whole paisa, banker's rounding**
    (`saleService.js:199`, the rule every sale already uses). So 5.5 gaz × Rs 11/gaz =
    6050 paisa exactly; 7.25 gaz × Rs 10.50/gaz → full-precision line, half-even to whole
    paisa at the total. No float anywhere; the only rounding is the established
    whole-paisa-at-the-payable step. `costAtTime = avgCost` (already per gaz) is snapshotted
    as-is — **cost is never divided at sale time** (it was divided once, at purchase).
    **Zero sale-path code change** beyond display.
- **Retail price is per gaz, integer paisa, entered directly.** The per-bundle figure is
  display-only (`retailPerGaz × 90`); we never store it, so there is **no retail rounding
  problem** (the owner sets the exact per-gaz price they sell at).
- **Display (÷90):** `bundles = floor(totalGaz / 90)`, `looseGaz = totalGaz − bundles×90`.
  Render "B bundles + L gaz" (omit a zero part). Negative stock renders honestly (e.g.
  "−5 gaz"). A pure shared helper does this; it never rounds the underlying gaz.
- **The flag is display/entry only** — it changes how numbers are *entered and shown*,
  never the stored canonical values. Flipping `bundle` on an existing gaz item with stock
  does **not** alter stockQty/avgCost; it only changes how they're presented and how the
  next purchase is entered.
- **Replay/reversal/recalculate-cost:** untouched — they already operate on the canonical
  per-gaz movements. **The regression test (the safety property) asserts these EXACT
  equalities** between a bundle item B and a control gaz item C:
  - **Setup:** B buys `5 bundles @ Rs 900/bundle` (via the conversion). C buys
    `450 gaz @ Rs 10.00/gaz` (hand-entered per-gaz — a *clean-dividing* price so the
    control is expressible through the normal ≤2dp path).
  - **After purchase:** `B.stockQty === C.stockQty` (both `"450"` gaz) **and**
    `B.avgCost === C.avgCost` (both exactly `"1000"` paisa/gaz) — string-equal Decimal.
  - **Weighted-average holds:** a second buy (B: `3 bundles @ Rs 1080`; C: `270 gaz @
    Rs 12.00`) leaves `B.avgCost === C.avgCost` and `B.stockQty === C.stockQty`.
  - **On a subsequent sale of the same gaz on each:** the snapshotted
    `costAtTime` is equal, the line **profit** is equal, and the resulting `stockQty` is
    equal.
  - **Replay equivalence:** `recomputeItemCostByReplay(B)` returns the same `avgCost` and
    `stockQty` as `recomputeItemCostByReplay(C)` — proving the ÷90-at-purchase conversion
    introduced **zero drift** in the engine.
  - **Plus a precision/reconciliation test for a NON-clean bundle** (`Rs 950/bundle`, which
    can't be entered as ≤2dp per-gaz, so it has no hand-entered control): assert
    (a) `avgCost === divide(95000, 90, 10, HALF_EVEN)` exactly (the stored per-gaz cost),
    (b) the **supplier payable === bundles × 95000** exactly (no leaked paisa), and
    (c) `90 × avgCost` reconciles to `95000` within the 10-digit scale.

## 7. Validation rules

- `Item.bundle`: boolean, optional (default false). Refinement: `bundle === true` ⇒
  `baseUnit === "gaz"` (else a clear validation error), on both create and update schemas.
- **Purchase line for a bundle item** (entry shape): `bundles` = positive decimal string;
  `pricePerBundle` = rupees ≤2dp (the existing money validator). The line's
  meaning (bundles vs base-unit qty) is resolved server-side by reading `item.bundle`;
  the wire shape stays `{ itemId, qty, unitCost }` where, for a bundle item, `qty` =
  bundles and `unitCost` = price per bundle. (Decision §9.2.)
- `BUNDLE_GAZ` is a constant, never user input.

## 8. Acceptance criteria (checklist)

- [ ] An owner can mark a gaz item "bought by the bundle"; the flag is blocked on
      non-gaz items (both ends).
- [ ] Buying 5 bundles @ Rs 900 makes stock = 450 gaz and avgCost = Rs 10.00/gaz; a
      second buy at a different bundle price gives the correct weighted per-gaz avg.
- [ ] COGS on a gaz sale uses the per-gaz cost; profit per gaz is correct.
- [ ] **A bundle-item purchase replays/reverses identically to the equivalent per-gaz
      purchase** — the exact equalities in §6 (stockQty, avgCost, costAtTime, profit,
      replay result), plus the non-clean-bundle reconciliation (exact payable, exact
      Decimal avgCost, no leaked paisa).
- [ ] Per-gaz cost is stored as Decimal128 at scale 10 (never rounded to whole paisa);
      the supplier payable equals bundles × price-per-bundle exactly.
- [ ] **Fractional-gaz sale** (e.g. 5.5 gaz) computes the line at full precision and rounds
      the payable half-even to whole paisa; cost is NOT divided at sale time.
- [ ] Stock shows as "B bundles + L gaz" for bundle items; plain gaz otherwise.
- [ ] The per-gaz rate is colour-highlighted for bundle items in Inventory + POS picker.
- [ ] Wholesale (if set) is per-gaz and works through the existing retail/wholesale toggle.
- [ ] Opening stock can be declared in bundles + per-bundle cost (ADR-013 path).
- [ ] Selling 7.5 gaz decrements stock by 7.5 and snapshots per-gaz cost.
- [ ] **Flipping the flag mutates NO stored value** (stockQty/avgCost/retailPrice
      byte-identical before/after) and never reinterprets an existing stock number.
- [ ] The 90 constant is single-sourced; no per-item bundle-size field exists.
- [ ] Money/stock writes spanning collections stay in one transaction; tests cover the
      bundle↔gaz conversion + COGS.
- [ ] Works fully through the UI with no AI.

## 9. Open questions — RESOLVED (2026-06-28)

1. **Retail price → entered & stored PER GAZ, exact.** Per-bundle (×90) is a display-only
   hint. No rounding on retail. (See the asymmetry callout in §6.)
2. **Cost → bundle price ÷ 90 at PURCHASE time** (once, at entry), per-gaz thereafter;
   never divided at sale time. (Owner's explicit emphasis — §6 asymmetry callout.)
3. **Purchase/opening → bundles + price-per-bundle**, converted server-side. **Fractional
   bundles allowed** (e.g. 2.5 → 225 gaz; ×90 is exact).
4. **Sale → in gaz only**, with a bundles+loose display hint (no "sell N bundles").
5. **Marker → a per-item `bundle` boolean** on gaz items ("Bought by the bundle (90 gaz)").
6. **Existing gaz wire items → no migration**; flip the flag when ready, stock/cost
   untouched.
7. **ADR-019 → yes.**

## 10. Notes / decisions

- **Why a fixed-90 flag, not the locked `units[]`/`factorToBase` extension point (spec
  001):** that mechanism is built for *variable* multi-unit factors; the owner's hard
  constraint is a single universal 90. A boolean + one constant is simpler, impossible to
  misconfigure, and exactly the requirement. If a variable bundle size ever arrives, the
  `units[]` path is still there for a future spec.
- **Why total-gaz, not sealed-vs-loose:** COGS, pricing, and decrement only need total
  gaz; bundles-vs-loose is a *view*. Tracking sealed bundles separately would add a
  reconcile burden for no correctness gain at this shop's scale (matches the "optimise for
  correctness + ease of use, not scale" mandate).
- **Why the cost engine is untouched:** by converting bundle→gaz at the *entry boundary*
  and storing canonical per-gaz movements, replay/reversal/COGS (003/003b/004) need zero
  changes — the riskiest code stays frozen. This is the central safety property.
