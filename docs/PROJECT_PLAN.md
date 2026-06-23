# SparkPOS — Project Plan & Product Spec

> Single source of truth for the project. Keep this file updated. Claude Code reads
> `/CLAUDE.md` (which points here) at the start of every session.

---

## 1. What we are building

A point-of-sale + inventory + accounting system for a single electronics retail shop
(three floors of stock: basement, ground, first floor). Built first for the owner, later
usable by trusted workers. Low traffic — one shop, a handful of users — so we optimise for
**correctness and ease of use, not scale**.

Two ways to operate the system:

1. **Manual UI** — buttons, forms, search. The reliable default. Everything must be doable
   here without any AI.
2. **Conversational layer (added later)** — type/speak "sold 5 meters of 7/29 wire at 120"
   and the assistant records the sale and updates stock. Plus a Q&A chatbot over the
   inventory and business data ("how much GM wire do we have left?", "what was last month's
   profit?").

The AI is a **convenience layer on top of a complete manual system** — never a dependency.
If the AI is switched off, the shop still runs.

---

## 2. The real challenge (read this first)

The code is the easy part. The two things that actually decide success:

### 2.1 Cataloguing the inventory
The shop has thousands of items, many tiny, many with no manufacturer barcode (local-made
fans, loose buttons, spare belts, copper wire by gauge). **Entering this data is the biggest
job in the whole project** — bigger than writing the software. Plan for it deliberately:

- Build a fast "add item" flow and a **CSV/Excel bulk import** early, so data entry isn't
  trapped behind one-by-one typing.
- Catalogue in waves, by floor and by category, not all at once.
- Accept that the catalogue will be messy and incomplete at first and will improve over time.
- The AI chat is genuinely useful *here*: searching by fuzzy name beats scanning when items
  have no barcode.

### 2.2 Getting profit right
"Profit" is only correct if we track **cost price** and pick an **inventory valuation method**.
Profit = Sales − Cost of Goods Sold (COGS). COGS depends on what you paid, which changes
between purchase batches. Decision: use **Weighted Average Cost** (simplest to get right for
a shop like this). Every purchase updates the average cost; every sale records COGS at the
current average. Without this, the "profit" numbers are fiction. This is non-negotiable for
the accounting feature to mean anything.

---

## 3. Domain requirements the owner didn't list but the shop needs

These come from how a Pakistani electronics retail shop actually operates. Confirm each with
the owner, but design for them from day one because retrofitting later is painful.

| Requirement | Why it matters | Design impact |
|---|---|---|
| **Multiple units of measure** | Wire sold per meter or per coil; copper by weight or gauge number; buttons per piece or dozen; fans per piece; sheets per piece. | Each item has a base unit + optional sell units with conversion factors. Stock stored in base unit. |
| **Customer credit / udhaar (khata)** | Local shops sell on informal credit constantly. "Profit" and cash-in-hand differ from sales. | Customer ledger: track who owes what, record part-payments, see outstanding balances. |
| **Wholesale vs retail price** | Same item sells at different rates to walk-ins vs dealers. | Item carries retail price + optional wholesale price; sale screen lets you pick or override. |
| **Supplier / purchase tracking** | Profit needs cost; reorder needs supplier; you buy on credit too. | Purchase entries update stock + average cost; supplier ledger mirrors customer ledger. |
| **Currency = PKR** | Formatting, rounding. | Store amounts in paisa (integer) or use decimal(12,2). Never use floats for money. |
| **Returns / exchanges** | Faulty fan, wrong belt — happens daily. | Sales must be reversible; stock + ledgers must reflect returns. |
| **Discounts & price overrides** | Bargaining is normal. | Every sale line allows a manual price; record the discount so reports are honest. |
| **Urdu / mixed input (AI phase)** | Owner may type Roman Urdu or Urdu. | The Claude model handles this well; just don't hard-code English-only parsing. |
| **No barcodes on most items** | Local goods. | Strong search-by-name + your own SKU scheme; optional printed labels later, not first. |

---

## 4. Build vs buy (honest note)

Off-the-shelf POS (open-source like a Vue/Laravel POS, or local SaaS) would cover basic
inventory + sales faster. We are building custom **specifically because** of the conversational
AI layer and full control — and because it's a family asset you'll maintain. That's a valid
reason. But: **do not let the custom AI ambition delay the boring, essential POS core.** Ship
the core first; it must stand on its own.

### 4.1 MongoDB vs PostgreSQL — the honest trade-off

We chose MongoDB (decision: see §5 and ADR-001) because the developer already knows MERN, and
shipping with a known stack beats a theoretically cleaner one you don't know. Documented here
so the trade-off isn't forgotten:

**Where Postgres would have been safer for this domain:**
- **Referential integrity.** Postgres stops you, at the database level, from deleting an Item
  that sales still reference, or inserting a Sale pointing at an Item that doesn't exist.
  MongoDB enforces none of this automatically — every such rule has to be written and
  remembered in application code.
- **Transactions are native, not bolted on.** Postgres transactions are the default; Mongo's
  multi-document transactions are a session-based feature that must be explicitly opened
  (`mongoose.startSession()` + `withTransaction`) in every write that spans more than one
  collection. Forgetting this even once is how stock/ledger/cost quietly drift apart.
- **Money precision.** Postgres has a native exact `DECIMAL`/`NUMERIC` type. Mongo's default
  number types are doubles; exact decimal storage (`Decimal128`) is supported but more
  awkward to apply consistently across a Node/Mongoose app.

**Why it's still an acceptable choice for this project:** a single shop, a handful of users,
no real concurrency or scale pressure. The risks above are about *discipline*, not capability
— fully manageable as long as the transaction rule in `CLAUDE.md` golden rule #3 is followed
without exception, and `Decimal128` (or paisa-as-integer) is used consistently for money.

**Escape hatch if the business grows:** migrate just the accounting-critical collections
(`Sale`, `Purchase`, `Payment`, `StockMovement`) to Postgres later, keep the rest in Mongo.
Not needed now — just worth knowing it's not a dead end.

---

## 5. Tech stack (decided: MERN)

**Decision: MERN (MongoDB, Express, React, Node).** The developer already knows this stack —
shipping with a stack you know beats a theoretically "purer" stack you don't. The one real
risk of Mongo for this domain is consistency: a single sale touches **stock, customer/supplier
ledger, and cost (COGS)** at once, and all three must succeed or fail together. This is
solved with MongoDB's multi-document transactions (`session.withTransaction`) — not automatic
like a relational DB, but fully supported. **Every service function that writes to more than
one collection must use a transaction.** This is the one rule we will not bend on.

**Stack:**

- **React (Vite, plain JavaScript/JSX)** — frontend. Built with Vite, not Create React App —
  CRA is deprecated by the React team; Vite is the current standard starting point, with the
  exact same React skills (components, JSX, hooks, props), just a faster, simpler build tool
  around them.
- **Node.js + Express (JavaScript)** — backend API.
- **MongoDB + Mongoose** — Mongoose schemas give structure, validation, and middleware on top
  of raw Mongo; its transaction API (`mongoose.startSession()` + `withTransaction`) handles the
  multi-collection writes safely.
- **Tailwind CSS + shadcn/ui** — fast, clean, accessible UI components.
- **TanStack Query** — server-state/data fetching and caching on the client.
- **Zustand** — light global client state (cart/sale-in-progress, UI state). No Redux needed
  at this scale.
- **Zod** — runtime validation; the same schema shape validates the API request body and the
  React form, so the rules live in one place.
- **Recharts** — the analytics graphs (sales/profit over time).
- **Auth:** username + hashed password (bcrypt), JWT or session cookie (cookie is simpler and
  fine for a single shop on a local network). One owner account now; `role` field ready for
  workers later (`owner` / `worker`).
- **Hosting:** a single small VPS, or MongoDB Atlas (free/small tier) + Render/Railway for the
  app. One shop = tiny resources, no need to over-provision.
- **Money:** never raw floats. Either store integer **paisa** (multiply/divide by 100 only at
  the UI boundary) or use a fixed-point library (e.g. `decimal.js`) consistently. Pick one and
  apply it everywhere — mixing approaches is how rounding bugs creep in.

**On TypeScript:** plain JavaScript throughout to match the React you've already learned — no
need to learn TypeScript to start this project. It remains an option later, file by file
(especially around the money/stock logic), but it's a nice-to-have, never a blocker.

---

## 6. The AI layer (when you get to it)

The owner asked: OpenAI Agents SDK or what? Recommendation:

- **Use Anthropic (Claude), not OpenAI** — you're already in the Claude ecosystem and using
  Claude Code; one ecosystem is simpler, and Claude's tool use is excellent for this.
- **Start with the plain Messages API + tool use (function calling)** — NOT a heavy agent
  framework. Your needs ("record this sale", "what's the stock of X", "last month's profit")
  are a small, well-defined set of tools. A direct Messages-API loop where the model calls
  your functions is simpler, cheaper, and easier to debug than the full Claude Agent SDK.
- **Graduate to the Claude Agent SDK only if** workflows become genuinely open-ended and
  multi-step. For a shop assistant, you likely never need it.
- **Model choice:** use **Claude Haiku 4.5** for cheap, fast everyday queries; step up to
  **Claude Sonnet 4.6** if you need stronger reasoning on the conversational-sale parsing.
  (Opus is overkill and costly for this.)
- **Pattern:** define tools like `record_sale`, `lookup_stock`, `get_report`,
  `add_purchase`. The model turns a sentence into a tool call; **your backend still validates
  and executes** — the AI proposes, your code disposes. Critically: a conversational sale
  should produce a **confirmation step** before it commits stock/money, until you trust it.
- **Low-stock alerts** are NOT an AI feature — they're a simple scheduled check
  (`stock_qty <= reorder_level`) that creates a notification. Build it without any AI.

Docs to keep handy: Claude API messages + tool use, and the Claude Agent SDK overview (only
if you go that route).

---

## 7. Data model (first draft — refine in a real spec)

Core collections (Mongoose schemas, not final):

- **Category** — _id, name, parentId (for floor/section hierarchy), …
- **Item** — _id, sku, name, categoryId, baseUnit, reorderLevel,
  avgCost (paisa), retailPrice, wholesalePrice, isActive, stockQty (cached, kept in sync
  inside the transaction that moves it), …
- **ItemUnit** — embedded sub-document on Item: unitName (e.g. "coil"), factorToBase
  (e.g. 90 m) — optional, for items sold in more than one unit.
- **StockMovement** — _id, itemId, qty (+in/−out), type (purchase|sale|return|adjustment),
  refId, costAtTime, createdAt. The append-only audit trail; `stockQty` on Item is a cache
  derived from this, always updated in the same transaction.
- **Supplier** / **Customer** — _id, name, phone, openingBalance, …
- **Purchase** (with embedded lines) — supplier, date, lines (item, qty, cost) → updates stock
  + avgCost.
- **Sale** (with embedded lines) — customer (optional), date, lines (item, qty, unit, price,
  costAtTime → COGS), paymentType (cash|credit), discount, …
- **Payment** — ledger entries for customer/supplier credit settlement.
- **Expense** — _id, date, category, amount, note (rent, electricity, salaries…).
- **User** — _id, username, passwordHash, role.
- **Notification** — low-stock and other alerts.

Money: store as integer paisa (or apply `decimal.js` consistently — pick one). Every
sale/purchase/return runs inside a single MongoDB **transaction**
(`mongoose.startSession()` + `withTransaction`) so stock + ledger + COGS never drift apart.

---

## 8. Reports & analytics

- **Daily:** sales total, cash vs credit, expenses, gross profit (sales − COGS), items sold.
- **Weekly / Monthly / Yearly:** sales, COGS, gross profit, expenses, **net profit**
  (gross − expenses), top items, dead stock (no movement in N days).
- **Inventory valuation:** total stock value at avg cost (an asset figure).
- **Receivables/Payables:** who owes us / who we owe.
- **Graphs (Recharts):** sales trend, profit trend, category breakdown, cash-flow.

All reports computed from real recorded transactions — never hand-entered totals.

---

## 9. Roadmap (build in this order)

**Phase 0 — Foundations (spec + skeleton)**
Repo, CLAUDE.md, this plan, DB schema, auth, app shell, CI, one passing test. No features yet.

**Phase 1 — Inventory core** — ✅ **SHIPPED** (specs 001, 002)
Categories, items (with units), stock view, search, add/edit, **bulk CSV import**, manual
stock adjustments. *This is the foundation everything sits on.*

**Phase 2 — Purchases & cost** — ✅ **SHIPPED** (specs 003, 003b)
Suppliers, purchase entry → updates stock + weighted-avg cost; purchase reversals + supplier
returns with replay-based avgCost repair (003b). Now cost data exists.

**Phase 3 — Sales / POS core** — ✅ **SHIPPED** (specs 004, 004b)
Sale screen, line items, units, per-line price override, cash vs credit (khata), COGS + profit
recorded per sale, customer ledgers, negative-stock view; sale void + customer returns (004b,
stock-only, no replay). *This is the heart of the app.*

**Phase 4 — Ledgers**
Customer & supplier balances, part-payments, statements.

**Phase 5 — Expenses & daily close** — ✅ **SHIPPED** (spec 005)
Flat Expense + DrawerAdjustment collections (no ledger, no balance) and a tiny DayClose row
that persists the carried-forward float. Read-mostly daily-close screen: the §6 cash-math table
(starting cash → cash sales, customer/supplier payments, drawer in/out, refunds, expenses →
expected cash), actual-counted-vs-expected difference, gross-profit/expenses/net section, stale
+ un-closed-days banners, and per-line click-to-drill-down into the underlying transactions.
Aggregation buckets by `createdAt` in Asia/Karachi (ADR-010); all payments counted as cash
until a non-cash path ships (ADR-009). *Verified end-to-end in the browser* — recorded
expenses + drawer adjustments, counted the drawer, closed the day, confirmed the float carried
forward to the next day, and confirmed drill-downs reconcile to each line total. **Headline
regression test** (`dailyClose.test.js`): closing a day then retroactively voiding that day's
sale flips the `stale` flag but leaves `actualCash` — and therefore the next day's starting
cash — unchanged (carry-forward is pinned to physically-counted cash, not recomputed expected).

**Phase 6 — Reports & analytics**
All reports + graphs. Low-stock notifications (simple scheduled check).

**Phase 7 — AI layer**
Q&A chatbot over the data (read-only first, safest), then conversational sales/stock with a
confirm step. Anthropic Messages API + tool use.

**Phase 8 — Polish & multi-user**
Worker accounts/roles, audit log, backups, printed receipts/labels if wanted.

Ship and *use* each phase before starting the next. Real usage by the owner will reshape the
backlog — that feedback is more valuable than any plan.

---

## 10. Non-negotiables (definition of done, every phase)

- Money never in floats. Every multi-step write in a DB transaction.
- Every feature usable manually before any AI touches it.
- Automated tests for the money/stock logic (COGS, valuation, ledger balances).
- Daily automated **database backup** — a shop's data is irreplaceable.
- Input validation on every form (Zod) — the owner will fat-finger numbers.
- Audit trail on sales/stock edits once workers are added.