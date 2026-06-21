# SparkPOS — backend

Node + Express + Mongoose API.

## Prerequisites

- Node 24+ (uses built-in `--env-file`, `--watch`, and `node --test`)
- MongoDB **running as a replica set** (see below — required for transactions)

## Setup

```bash
npm install
cp .env.example .env      # then edit MONGODB_URI / PORT
```

`.env`:

- `MONGODB_URI` — e.g. `mongodb://127.0.0.1:27017/sparkpos` (local) or an Atlas URI
- `PORT` — default `5001` (avoid `5000` on macOS — AirPlay/Control Center holds it)

## MongoDB must be a replica set

Multi-document transactions (`session.withTransaction`) — which every stock/ledger/COGS write
uses — require a replica set. A standalone `mongod` will throw. Production uses **MongoDB Atlas**
(already a replica set). For **local dev**, run a single-node set named `rs0`:

1. Enable replication in your `mongod.conf` (Homebrew default: `/usr/local/etc/mongod.conf`):

   ```yaml
   replication:
     replSetName: rs0
   ```

2. Restart mongod so it picks up the config:

   ```bash
   # Homebrew service:
   brew services restart mongodb-community
   # …or, if launchd-managed and brew refuses:
   launchctl kickstart -k gui/$(id -u)/homebrew.mxcl.mongodb-community
   ```

3. Initiate the set once (idempotent — safe to re-run; no `mongosh` needed):

   ```bash
   npm run rs:init
   ```

After this, connection strings can include `?replicaSet=rs0` (the driver also auto-discovers it).

## Run

```bash
npm run dev      # node --watch --env-file=.env (auto-reload)
npm start        # node --env-file=.env
```

Health check: `GET /api/health` → `{ status, db, time }`.

## Test

```bash
npm test         # node --test over tests/**/*.test.js
```

Tests connect to `mongodb://127.0.0.1:27017/sparkpos_test?replicaSet=rs0` (override with
`TEST_MONGODB_URI`). They require the replica set above, drop the test DB on teardown.

## Backups

There is **no per-item undo** for a bulk CSV import (spec 002) — take a backup before a large
import so a bad file can be rolled back wholesale. `mongodump`/`mongorestore` work against the
`rs0` replica set via `$MONGODB_URI`:

```bash
# Backup before a large import
mongodump --uri="$MONGODB_URI" --out="./backups/$(date +%Y-%m-%d-%H%M)"

# Restore (drops existing collections first, then reloads the dump)
mongorestore --uri="$MONGODB_URI" --drop ./backups/<folder>
```

`./backups/` is local scratch — keep it out of version control. (`mongodump` ships with the
MongoDB Database Tools; `brew install mongodb-database-tools` if the command is missing.)

## Layout (Phase 1 so far)

```
src/
  lib/decimal.js          exact BigInt-backed decimal helpers (no floats, no deps)
  models/                 Category, Item, StockMovement, Counter, Settings
  services/
    skuService.js         per-prefix atomic SKU generation (<CAT>-<NNNN>)
    itemService.js        createItem (+opening movement) & adjustStock — both transactional
  scripts/initReplicaSet.js
tests/                    decimal unit tests + itemService transaction tests
```
