# CLAUDE.md

This file is read by Claude Code at the start of every session. Keep it short, current, and
accurate. It is the map; the detail lives in `docs/`.

## Project

**SparkPOS** — point-of-sale + inventory + accounting system for a single electronics retail
shop (three floors of stock). Built for the owner first, trusted workers later. Low traffic.
Optimise for **correctness and ease of use, not scale**.

Read `docs/PROJECT_PLAN.md` for the full product spec, domain model, and roadmap. Read the
active spec in `docs/specs/` before implementing a feature.

**Status:** Phases 1–3 + 5 + 6 shipped (specs 001, 002, 003, 003b, 004, 004b, 005, 006, 006b,
006c, 008). Purchase side and sell side are both fully recoverable in-app (reversals/voids/returns);
expenses, drawer adjustments, and a daily-close screen (cash math + gross profit/net + per-line
drill-downs) are live; a windowed Reports screen (headline tiles with vs-prior deltas,
profit-per-day trend, item performance + dead stock, expense breakdown, khata snapshot) reads
all numbers on-the-fly from immutable sources (ADR-011); product images (one per item, stored
outside Mongo behind a storage-driver interface — ADR-012) show across Inventory, the POS
picker, and Reports; opening stock is a first-class cost-bearing declaration with an owner-only
repair tool for legacy cost = 0 items (ADR-013); **Quick Sale** lines sell uncatalogued goods
(name + price, no stock, no cost basis) — their revenue counts as cash but is kept out of COGS
gross profit everywhere it's reported (ADR-016). **The correctness foundation is complete and
the profit numbers are honest. Next: Phase 7 — AI layer (reasons over those numbers).**

## Golden rules

1. **Manual first, AI second.** Every feature must work fully through the UI with no AI. The
   AI layer is a convenience on top, never a dependency.
2. **Money is never a float.** Store PKR as integer paisa or `Decimal`. No `number` for money.
3. **One transaction, no drift.** Any operation that touches stock + ledger + COGS happens
   inside a single MongoDB transaction (`mongoose.startSession()` + `withTransaction`) — all
   succeed or all roll back. Non-negotiable for any write spanning more than one collection.
4. **Profit = Sales − COGS.** COGS uses **weighted-average cost**, updated on every purchase.
   Don't compute "profit" any other way.
5. **Validate every input** (Zod) on both frontend and backend.
6. **Write a spec before a feature.** See "Workflow" below.

## Tech stack

- React (Vite, plain JavaScript/JSX) — frontend
- Node.js + Express (JavaScript) — backend API
- MongoDB + Mongoose — data layer
- Tailwind CSS + shadcn/ui
- TanStack Query, Zustand (client state), Zod (validation)
- Recharts (analytics) — installed (spec 006)
- Auth: hashed password (bcrypt) + JWT or session cookie; `role` = `owner` | `worker`
- AI (later): Anthropic Claude **Messages API + tool use** (Haiku 4.5 default, Sonnet 4.6 when
  needed). Start with a plain tool-use loop, not the Agent SDK.

Plain JavaScript throughout, matching the React you've already learned — no TypeScript
required to start. (TypeScript can be added later, file by file, if you want stronger
safety around the money/stock code specifically — it's a nice-to-have, not a blocker.)

## Project structure

```
spark-pos/
  CLAUDE.md                  ← you are here
  docs/
    PROJECT_PLAN.md          ← product spec, domain model, roadmap (source of truth)
    DECISIONS.md             ← short log of architectural decisions (ADR-style)
    specs/                   ← one spec file per feature, written before coding
  frontend/                   ← React app, created with Vite
    index.html
    package.json
    vite.config.js
    src/
      main.jsx                  ← entry point, mounts <App />
      App.jsx                   ← top-level layout/routes
      pages/                     ← one file per screen (Inventory, Sales, Reports, Login, …)
      components/                ← reusable UI pieces (Button, Table, Modal, …)
      features/                  ← feature folders (inventory/, sales/, purchases/, reports/)
        inventory/
          ItemForm.jsx
          ItemList.jsx
          api.js                   ← fetch calls for this feature only
      lib/                       ← apiClient.js, formatMoney.js, validation.js
      store/                      ← Zustand stores (cart/sale-in-progress, auth, ui)
  backend/                    ← Node + Express app
    package.json
    src/
      index.js                   ← starts the Express app
      db.js                       ← Mongoose connection
      models/                     ← Item.js, Sale.js, Purchase.js, Customer.js, …
      routes/                     ← itemRoutes.js, saleRoutes.js, …
      controllers/                ← itemController.js, saleController.js, …
      services/                   ← business logic — money/stock/COGS transactions live here
      middleware/                 ← auth.js, errorHandler.js, validate.js
  shared/                     ← validation rules used by both frontend and backend
  tests/                       ← tests, esp. for money/stock/COGS logic
```

### Why a separate `frontend/` (Vite) and `backend/` (Express), not one combined app

This keeps the React app and the Node API as two independent things that talk over HTTP —
the same mental model as the React you've already learned, just with its own real backend
instead of a tutorial's fake API. You'll run two terminals in development (`npm run dev` in
each), which is normal for this setup. (`frontend`/`backend` is the naming convention used
across most real company codebases — `client`/`server` is the same idea, just more common in
tutorials; either works, this is the one we picked.)

### Why Vite, not Create React App (CRA)

If you learned React with `create-react-app`, know that the React team has officially
**deprecated CRA** — it's no longer the recommended way to start a project, for anyone, at
any skill level. Vite is the current standard replacement:

- **Much faster** — starts in under a second, reloads almost instantly on save (CRA can take
  10–30+ seconds to start and several seconds per save). You'll feel this constantly while
  building.
- **Same React skills, same files.** Components, JSX, hooks, props — identical. Only the
  surrounding build tool changes, and Vite's setup is simpler, not more advanced.
- **Actively maintained** and what current tutorials, the React docs, and Claude Code all
  assume going forward.

To start the frontend: `npm create vite@latest frontend -- --template react`. Same
`npm install` / `npm run dev` workflow you already know.

## Workflow (spec-driven)

For any non-trivial feature:

1. Copy `docs/specs/SPEC_TEMPLATE.md` → `docs/specs/NNN-feature-name.md` and fill it in.
2. Ask me (Claude Code) to **review the spec and list open questions** before any code.
3. Implement against the agreed spec, with tests for the money/stock parts.
4. Update `docs/DECISIONS.md` if a real architectural choice was made.
5. Keep this file and `PROJECT_PLAN.md` accurate as things change.

## Commands

<!-- Fill these in once the project is scaffolded. -->
- Install (root, if using workspaces) or in each of `frontend/` and `backend/`: `npm install`
- Dev (backend): `npm run dev` (in `backend/`)
- Dev (frontend): `npm run dev` (in `frontend/`)
- DB: MongoDB connection string in `backend/.env` (`MONGODB_URI=...`); no migrations needed,
  but seed scripts go in `backend/src/scripts/`
- Test: `npm test`
- Lint/format: `npm run lint`

## When unsure

Ask a clarifying question rather than guessing on anything involving money, stock, or how the
shop actually operates. A wrong assumption about valuation, units, or credit is expensive to
unwind later.