# Spec: 007 — Authentication & users (Phase 8, pre-deployment)

- **Status:** approved — ready to build (review resolved 2026-06-25; all §9 questions closed,
  five blockers resolved into this doc)
- **Phase:** Phase 8 — the deferred-from-day-one auth phase. Time-sensitive: must ship
  BEFORE production deployment. There is no scenario where this app goes on a public URL
  without this phase being done correctly.
- **Author / date:** <you> / <fill in>
- **Builds on:** everywhere `createdBy` is currently a placeholder, every owner-gated
  endpoint, every screen behind the simple "owner" boolean. Touches almost every existing
  route — every endpoint either requires authentication or is deliberately exempt.

## 1. Problem / goal
The app is about to be deployed to a public URL. Currently:
- There is no User model, no login screen, no password hashing, no session management.
- The "owner-only" gating across the codebase is a placeholder — a boolean assumption
  that's been a documented TODO since spec 001.
- Every `createdBy` field is a placeholder ObjectId, not a real user.
- Anyone who finds the URL after deployment can read customer ledgers, supplier debts,
  cash drawer totals, sales history, and reports — and can ring up fake sales, void real
  sales, edit inventory, anything.

**Goal:** before deployment, every screen and every endpoint requires authentication.
Two user roles exist: `owner` (full access, same as today's placeholder) and `worker`
(restricted to sales-related operations only). The owner can create, deactivate, and
reset worker accounts.

## 2. Why this spec is different from everything before it
Every prior spec was about correctness inside a trusted system. This spec is about
**trust boundaries** — the assumption that "the person at the keyboard is the owner" stops
holding the moment the app is on the internet. Three things make this category different:

1. **Adversarial input must be assumed.** Login forms get probed automatically by bots.
   Every input is a potential attack surface — passwords, usernames, session cookies.
2. **Cryptography correctness matters more than feature breadth.** A bug in password
   hashing or session validation is not a "small UX issue" — it's "every account is
   compromised." The few crypto-touching pieces of this spec must be done with proven,
   battle-tested libraries (`bcrypt` or `argon2` for password hashing, `jsonwebtoken` or
   express's session middleware for sessions). NO hand-rolled crypto. NO storing
   passwords in plaintext, reversibly encrypted, or with a fast hash like MD5/SHA1/SHA256.
3. **The deployment environment shapes the design.** HTTPS, secure cookies, CSRF
   protection — these depend on how the app is deployed (which platform, which domain,
   whether the API and frontend share an origin). Some of those are deployment-time
   config, not in-code; they must be CALLED OUT in the spec so they aren't forgotten.

This spec is also the only one where "ship it slightly wrong and fix later" is NOT
acceptable. Phase 5 with a small bug ships and gets patched. This phase with a small bug
is a data breach. The review-first / test-first discipline matters here more than it has
mattered anywhere in this project.

## 3. User stories
- As the owner, I want to log in with a username and password I chose, so that nobody who
  finds the deployed URL can use the app without my credentials.
- As the owner, I want to create worker accounts (username + initial password I share
  with the worker), so my worker can ring up sales while I'm away.
- As the owner, I want to deactivate a worker account (e.g. they left the shop) so they
  can no longer log in, without deleting their history of actions.
- As the owner, I want to reset a worker's password if they forget it (since there's no
  email-based reset flow in v1 — it's a single-shop app, this is the realistic recovery path).
- As the owner, I want every action recorded under the actual user who did it, not a
  placeholder, so history is real.
- As a worker, I want to log in and ring up sales without being able to break things I'm
  not supposed to touch (can't void sales, can't edit inventory, can't see reports, can't
  see daily-close, can't edit other users).
- As anyone, I want my session to time out after a reasonable period of inactivity, so a
  laptop left unattended doesn't expose the app.
- As anyone, I want a clean logout so I can step away from the shop's computer and the
  next person needs to log in.

## 4. Scope
**In scope:**
- **User model**: username (unique, case-insensitive), passwordHash, role (`owner` |
  `worker`), isActive, createdAt, createdBy (the owner who created them — owners have no
  createdBy, they're the founding account), lastLoginAt.
- **Bootstrap**: a first-run setup screen that creates the initial owner account if no
  user exists yet. This is the only path to creating an owner — owners cannot create
  other owners (avoids the "worker promotes themselves" attack surface and matches the
  single-shop reality). Bootstrap is gated by "is the User collection empty?" check.
- **Login flow**: username + password → server validates against passwordHash via the
  hashing library's compare function (constant-time, not string equality) → on success,
  issues a session.
- **Session mechanism (resolved → sessions)**: **HTTP-only, secure, SameSite=Strict cookies**
  with a server-side session store — `express-session` backed by `connect-mongo` (NOT JWT;
  see §9.2). Chosen because they invalidate cleanly on logout/deactivation/role change without
  a token blacklist, and the API and frontend share an origin in production. 12-hour TTL with
  sliding expiry on activity. Cookie is HTTP-only (not readable by JS), secure (HTTPS-
  only in production), SameSite=Strict (CSRF protection at the cookie level).
- **Middleware**: `requireAuth` (any logged-in user) and `requireOwner` (owner role only),
  applied to every existing route per the role matrix in §6.
- **User management (owner-only screens)**:
  - List users (active + inactive).
  - Create worker (username + initial password).
  - Deactivate user (cannot deactivate self; cannot deactivate the last active owner).
  - Reset password for a user (owner sets a new password for any worker; owner can
    change their own password too).
  - No user delete — deactivate only, audit trail preserved.
- **Profile page (any logged-in user)**:
  - See own username + role + last login.
  - Change own password (requires current password to authorize the change).
  - Logout.
- **Replace every placeholder `createdBy`** with the session user's id at the point of
  every existing write endpoint. Existing data with placeholder createdBy is migrated to
  point at the bootstrap owner once it's created (one-time migration script run at
  bootstrap; see §6).
- **Login attempt rate limiting**: 5 failed attempts within 15 minutes from the same
  username locks the account for 15 minutes (auto-unlock via timestamp, not a separate
  flag). The lockout message does NOT reveal whether the username exists.
- **Production serving (single-origin)**: in production, Express serves the built frontend.
  `vite build` emits `frontend/dist`; the backend mounts `express.static('frontend/dist')`
  plus an SPA fallback (any non-`/api`, non-static GET returns `index.html` so client-side
  routes resolve). This makes the API and the UI **one origin** in production, which is what
  lets `SameSite=Strict` cookies work cleanly with no CORS. The Vite dev proxy (`/api →
  :5001`) is **dev-only** and does not exist in production. (Resolution of review blocker 1.)

**Out of scope:**
- **Email-based password reset.** Single-shop app, no email infrastructure, owner is
  always physically reachable to reset a forgotten worker password. Adding email reset is
  a future spec with real consideration of mail provider, tokens, and rate limiting.
- **Multi-factor authentication / 2FA.** Not for v1. Reasonable for a future spec once
  the owner is comfortable with the basic flow.
- **OAuth / "sign in with Google."** Same reasoning — not for v1.
- **Granular per-feature permissions beyond owner/worker.** Two roles, fixed capability
  matrix per §6. If a third role is ever needed (e.g. "accountant — read-only reports"),
  it's a future spec.
- **Audit log of who-did-what beyond `createdBy` on existing records.** The existing
  `createdBy` everywhere becomes truthful (instead of placeholder) — that IS the audit
  trail. A separate "AuditLog" collection for login/logout/permission events is a
  future spec.
- **Password complexity rules beyond a minimum length.** v1: minimum 8 characters, no
  other rules. Over-strict password rules cause workers to write passwords on sticky
  notes — a real shop-floor problem. Length is the only correlation with real strength
  that matters at this user count.
- **"Remember me" / persistent login beyond the session TTL.** Worker logs in at the
  start of the shift, session covers the day, has to log in again the next day. This is
  what you want at a shop — a forgotten laptop should not stay logged in indefinitely.
- **Account self-recovery / "forgot my password" without owner intervention.** Owner
  resets workers' passwords. Owner resets own password via a server-side CLI script
  (§9.5, resolved).

## 5. Data model changes
- **New collection: `users`**
  ```
  username         String   required, unique, lowercase, trim, min 3 chars
  passwordHash     String   required (bcrypt hash, never the plain password)
  role             String   required, enum: 'owner' | 'worker'
  isActive         Boolean  default true
  createdBy        ObjectId ref User, optional (null for the bootstrap owner)
  createdAt        Date     auto
  updatedAt        Date     auto
  lastLoginAt      Date     optional (set on successful login)
  failedAttempts   Number   default 0 (incremented on bad password, reset on success)
  lockedUntil      Date     optional (set on lockout, checked against now on login)
  ```
  Unique index on lowercase(username).
- **No changes to existing models** beyond `createdBy` becoming a real, populated User
  reference instead of a placeholder ObjectId. The field is already there everywhere;
  this spec just makes it truthful.
- **Sessions** (resolved → express-session): stored in a `sessions` collection via
  `connect-mongo`. Auto-created by the library; not modeled by hand.
- **Migration**: one-time script run after bootstrap that finds all existing records with
  the placeholder `createdBy` ObjectId and updates them to point at the newly-created
  bootstrap owner's `_id`. Runs once, idempotent, no-op on second run. Touches the 10
  collections enumerated in §6 — not an open-ended "scan everything."
- **Frontend auth state is NOT a collection**: the client holds the current user in a React
  `AuthContext` (exposed via a `useAuth()` hook), hydrated from a `GET /api/auth/me` call on
  load and cleared on logout/401. No new client-state dependency (no Zustand).

## 6. Business rules
- **Password hashing (resolved → bcrypt, cost 12)**: never store plaintext, never store
  with a fast hash, never store with a homegrown algorithm. Compare via bcrypt's
  constant-time `compare` function.
- **Username comparison**: case-insensitive on login (`ahmed` and `Ahmed` are the same
  user). Stored lowercase. **No separate `displayName` (resolved)** — display = the
  lowercase username.
- **Session cookie**: HTTP-only, secure (in production via env), SameSite=Strict, name
  not the default (avoid fingerprinting), 12-hour TTL with sliding expiry on every
  authenticated request.
- **Logout**: deletes the session server-side, clears the cookie client-side.
- **Role matrix** (every existing route must be mapped to one of these):

  | Capability | Owner | Worker |
  |---|---|---|
  | Login / logout / change own password | ✅ | ✅ |
  | View own profile | ✅ | ✅ |
  | Ring up a sale (POS, both cash and credit) | ✅ | ✅ |
  | View customer khata (during sale flow) | ✅ | ✅ |
  | Create a customer (inc. inline in POS) | ✅ | ✅ |
  | Record customer payment | ✅ | ✅ |
  | Edit / deactivate / reactivate a customer | ✅ | ❌ |
  | View Inventory (read-only) | ✅ | ✅ |
  | View categories (read) | ✅ | ✅ |
  | Edit/Add/Delete inventory items | ✅ | ❌ |
  | Create / deactivate / reactivate a category | ✅ | ❌ |
  | Adjust stock | ✅ | ❌ |
  | CSV import / opening stock / repair tool | ✅ | ❌ |
  | View Sales History | ✅ | ✅ (own sales only — server-enforced) |
  | Void a sale | ✅ | ❌ |
  | Record a customer return | ✅ | ✅ |
  | View Suppliers + record purchases + supplier payments | ✅ | ❌ |
  | View Daily Close | ✅ | ❌ |
  | Record expense / drawer adjustment | ✅ | ❌ |
  | View Reports | ✅ | ❌ |
  | View Negative Stock | ✅ | ❌ |
  | Create / deactivate / reset worker accounts | ✅ | ❌ |
  | View other users | ✅ | ❌ |

  **Exempt routes (no auth — the ONLY routes that are neither login nor bootstrap).**
  Enumerated explicitly so this list can never grow silently (Resolution of review blocker 2):

  | Route | Why exempt |
  |---|---|
  | `GET /api/health` | Monitoring / load-balancer probe; must answer before bootstrap and without a session. |
  | `GET /api/static/items/:key` | Public-read product image bytes (ADR-012 / spec 006b). Public by design. |

  These two are also exempt from the empty-DB 503 gate and from the 401→/login redirect.
  Every other route requires `requireAuth`, and the owner-only rows additionally require
  `requireOwner`. **`View Sales History` and viewing a single sale are worker-visible but
  scoped: the server filters the list to the worker's own sales and returns 403 when a
  worker requests another user's sale by id — not merely hidden in the UI.**

- **Self-protection rules**:
  - A user cannot deactivate their own account (would lock themselves out).
  - The system must always have at least one active owner — deactivating the last
    active owner is rejected.
  - A user can only change their OWN password (workers cannot reset other workers'
    passwords). Only owners can reset OTHER users' passwords.
  - The change-own-password flow requires the user to enter the current password
    (proves it's actually them, not someone at an unattended terminal).
- **createdBy is now session.userId**, set in middleware before route handlers run, so
  no route handler needs to think about it.
- **Active-session revocation — `requireAuth` re-checks `isActive` (and `role`) on EVERY
  request**, not just at login (Resolution of review blocker 3). On each authenticated
  request it loads the session user's `{ username, role, isActive }` (a single, lightweight
  DB lookup — those three fields only, never the full document) and rejects with 401 if the
  account is no longer active. This is what makes "deactivate a worker" take effect on their
  **next request**, not at the 12-hour TTL. It also picks up a role change immediately. We
  use **server-side sessions specifically so this works without a token blacklist** — a
  revoked user simply fails the `isActive` recheck. This per-request recheck is the headline
  regression invariant of this spec (the equivalent of the recalculate-cost zero-drift check
  for 003b) and gets a dedicated acceptance test in §8.
- **Legacy `createdBy` migration touches exactly these 10 collections** (enumerated, not a
  "scan every collection" — Resolution of review blocker 5): `Sale`, `Purchase`,
  `StockMovement`, `CustomerPayment`, `SupplierPayment`, `CustomerReturn`, `SupplierReturn`,
  `DrawerAdjustment`, `Expense`, `ImportLog`. For each, every document whose `createdBy`
  equals the placeholder ObjectId (`000000000000000000000001`, today's `DEV_USER_ID`) is
  re-pointed at the bootstrap owner's `_id`. Idempotent: a second run matches nothing.
- **Login rate limiting**: 5 failed attempts within a 15-minute rolling window per
  username → lockout for 15 minutes (lockedUntil = now + 15 min). Successful login
  resets failedAttempts to 0. The lockout error message says generically "Too many
  failed attempts. Try again later." — never confirms whether the username exists.
- **Username enumeration**: login error for "wrong username" and "wrong password" must
  be the same message and same response time (or close enough). Standard practice.
- **No password printed, logged, or stored anywhere**. Not in error messages, not in
  console.log, not in audit logs, not in error stack traces. Reviewed in code.
- **Bootstrap flow**: at app startup, if `users` collection is empty, the only available
  routes are `GET /bootstrap` (the setup screen) and `POST /bootstrap` (create the first
  owner) — **plus the two exempt public reads above** (`GET /api/health`,
  `GET /api/static/items/:key`), which must answer even pre-bootstrap. All other routes
  return 503 "Setup required." Once an owner exists, bootstrap routes become 404. This gate
  is a **single middleware mounted ahead of the route table in `app.js`** — it does not
  touch individual route files. To avoid a DB hit per request, it caches an in-memory
  "an owner exists" flag, set false at startup and flipped true the moment bootstrap
  succeeds.
- **Frontend**: a single **`AuthContext` + `useAuth()` hook — no new dependency** (the app
  has no Zustand store today; React context is simpler and sufficient for one auth value).
  It holds the current user (id, username, role, isActive). All screen-level routing checks
  the user's role before rendering. The fetch wrapper (`apiClient`) attaches cookies
  automatically (same-origin in both dev — via the Vite proxy — and prod — via single-origin
  serving); on a 401 response it clears the auth context and redirects to `/login`.
  (Resolution of review blocker 4.)
- **Environment variables** required for production (call out in §10 for deployment
  checklist):
  - `SESSION_SECRET` — long random string, server-side cookie signing.
  - `NODE_ENV=production` — toggles secure-cookie flag.
  - `MONGODB_URI` — the production database (Atlas) connection string.
- **HTTPS is REQUIRED in production**. Secure-cookie + SameSite=Strict assume HTTPS.
  Deploying behind HTTP exposes session cookies to network sniffing. Call this out
  explicitly in §10.

## 7. Validation rules
- Username on create: lowercase, trimmed, 3-32 chars, alphanumeric + underscore +
  hyphen only (no spaces, no @, no quotes), unique (case-insensitive).
- Password on create or change: minimum 8 characters. No max upper bound below what's
  reasonable (bcrypt has a 72-byte limit — use 72 as the max).
- Login: username and password both required; never echo back which was wrong.
- Create user: only owner role can; payload validates username + password + role; role
  must be 'worker' (owners cannot create other owners, see §4).
- Deactivate user: cannot deactivate self; cannot deactivate the last active owner.
- Reset password: only owner can reset others; users can change their own (with current
  password verification).
- Reuse `shared/validation/*` patterns; new file `shared/validation/auth.js`.
- All validation runs server-side regardless of client-side validation. Client-side is a
  UX nicety only.

## 8. Acceptance criteria (checklist)
- [ ] Fresh DB → bootstrap screen prompts for first owner. All other routes return 503.
- [ ] After bootstrap, owner can log in; bootstrap routes return 404.
- [ ] Login with correct credentials succeeds, sets a HTTP-only/secure/SameSite=Strict
      cookie, lastLoginAt updates.
- [ ] Login with wrong password fails with generic error; failedAttempts increments.
- [ ] Login with unknown username fails with same message and similar timing.
- [ ] After 5 failed attempts in 15 min, account locks for 15 min; correct password
      during lockout still fails with "too many attempts."
- [ ] Successful login resets failedAttempts to 0.
- [ ] Logout clears the session server-side and the cookie client-side.
- [ ] Every existing endpoint requires authentication except: bootstrap, login, and the
      two named public reads (`GET /api/health`, `GET /api/static/items/:key`).
- [ ] Owner-only endpoints reject worker session with 403.
- [ ] Worker can ring up a sale; the sale's `createdBy` is the worker's userId (not
      placeholder).
- [ ] Worker cannot access the Reports / Daily Close / Inventory edit / Purchases /
      Suppliers / user management routes (403 from server, hidden in nav from client).
- [ ] Owner can create a worker; worker can immediately log in with that password.
- [ ] Owner can deactivate a worker; that worker's subsequent login fails with "Account
      is inactive."
- [ ] Owner cannot deactivate self; cannot deactivate the last active owner.
- [ ] Owner can reset another user's password; user logs in with the new password.
- [ ] Any user can change their own password; the change requires entering current
      password.
- [ ] Session times out after 12 hours of inactivity; activity refreshes the cookie.
- [ ] Existing data's `createdBy` is migrated to the bootstrap owner on first bootstrap
      (regression test: a sale created before this spec still has a valid createdBy
      pointing at a real User after migration).
- [ ] No plaintext password is logged anywhere (manual review + a test that
      intercepts logger output during a login flow and asserts no password substring
      appears).
- [ ] Password hashing uses bcrypt, cost factor 12.
- [ ] Username comparison is case-insensitive (`Ahmed`, `ahmed`, `AHMED` are the same
      account at login).
- [ ] Frontend auth context populates on login, clears on logout, redirects to /login
      on 401.
- [ ] Nav bar hides items the current role can't access (worker doesn't see Reports /
      Daily Close / Suppliers / etc. in the nav).
- [ ] On the deployed environment, the session cookie has Secure=true (regression: env
      var NODE_ENV=production triggers it).
- [ ] **Active-session revocation (HEADLINE TEST):** a worker logs in and makes an
      authenticated request successfully; the owner deactivates them; the worker's *next*
      authenticated request (same still-valid session cookie) is rejected 401 — i.e.
      `requireAuth` re-checks `isActive` per request, revocation does not wait for TTL.
- [ ] A role change is reflected on the next request (worker promoted/handled via the same
      per-request recheck — no re-login required for the server to see the new role).
- [ ] **Exempt public routes** (`GET /api/health`, `GET /api/static/items/:key`) remain
      reachable with no session, both before and after bootstrap; **no other** route is
      reachable without auth (the enumerated guard test in step 8 asserts this).
- [ ] **bcrypt 72-byte cap:** create-user and change/reset-password endpoints reject a
      password longer than 72 characters with a validation error (never silently truncate).
- [ ] **Lockout auto-expiry** (separate from "lockout fires"): once `lockedUntil` has
      passed, a correct password logs in again with no manual unlock and resets
      failedAttempts to 0.
- [ ] **Non-default cookie name:** the session cookie is NOT `connect.sid` or `session` —
      it uses a project-specific name (avoids stack fingerprinting).
- [ ] **Enumerated guard test (step 8):** a single test lists every route in every router
      file with its expected middleware (`requireAuth` / `requireOwner` / exempt) and
      asserts the actual mounted stack matches — failing if a new route is ever added
      without a guard.

## 9. Resolved decisions (was: open questions — all closed in review 2026-06-25)
1. **Password hashing → bcrypt, cost factor 12.** Wider ecosystem familiarity and simpler
   correctness review than argon2id; both are acceptable, bcrypt chosen.
2. **Session mechanism → server-side sessions** via `express-session` + `connect-mongo`
   (not JWT). We already run MongoDB, and sessions give clean revocation: logout, lockout,
   deactivation, and role change all take effect server-side with no token blacklist. This
   is also what makes the per-request `isActive` recheck in §6 possible.
3. **Workers CAN record customer returns** (normal customer-service action). Voids stay
   owner-only. ⇒ `POST /sales/:id/returns` = `requireAuth`; `POST /sales/:id/void` =
   `requireOwner`.
4. **Workers see ONLY their own sales — server-enforced.** The list endpoint filters by
   `createdBy === session user` for workers, and `GET /sales/:id` returns 403 when a worker
   requests another user's sale. UI hiding alone is not sufficient.
5. **Owner password recovery → a CLI script** (`backend/src/scripts/reset-owner-password.js`)
   run on the server, matching the existing `scripts/` convention. Single-shop, owner has
   server access. No email reset, no second-owner workaround.
6. **Legacy `createdBy` IS migrated** to the bootstrap owner once it's created, across the
   10 enumerated collections in §6. Owner's name on legacy records beats a "system"
   placeholder.

## 10. Notes / decisions
- **Deployment checklist** (this spec doesn't ship without these in place):
  - HTTPS configured on the deployment platform. Without it, secure cookies break and
    sessions don't survive page loads.
  - `SESSION_SECRET` env var set to a long, random, secret string (32+ chars, never
    committed). Generate with `openssl rand -base64 48`.
  - `NODE_ENV=production` set.
  - `MONGODB_URI` points at the production Atlas database.
  - `vite build` run and `frontend/dist` present, served by Express (`express.static` +
    SPA fallback) so production is single-origin (blocker 1). No separate static host /
    CDN in v1 — a second origin would break `SameSite=Strict`.
  - First-run bootstrap completed (owner account created) before any external user
    can hit the URL.
  - The migration script for legacy `createdBy` runs as part of bootstrap (10 enumerated
    collections, see §6).
- **ADR-014 (written with this spec)**: "Auth uses session cookies (HTTP-only, Secure,
  SameSite=Strict) backed by a server-side `connect-mongo` store; passwords hashed with
  bcrypt cost 12; no plaintext passwords anywhere; `requireAuth` re-checks `isActive`/`role`
  per request so revocation needs no blacklist; role enum stays `owner | worker` with the
  fixed §6 capability matrix; bootstrap is the only path to the first owner." Same voice as
  009/010/011/012/013.
- **ADR-015 (written with this spec)**: "Every deployed endpoint requires authentication
  **except bootstrap, login, and the two named public reads — `GET /api/health` and
  `GET /api/static/items/:key`**. Deploying without auth in front of every other endpoint is
  forbidden." The exemption list is closed and enumerated; adding to it requires a new ADR.
  This is the architectural invariant this spec creates and every future spec must preserve.
- **Build order** (every step has owner verification before the next):
  1. **(SLICE 1)** User model + Zod + bcrypt + auth service (createUser, verifyPassword,
     lockout logic). Tests: hash-on-create (passwordHash never the plaintext, never echoed
     back), username case-insensitive uniqueness, **72-byte password cap**, lockout fires at
     5 fails / 15 min, **lockout auto-expiry** (correct password works once `lockedUntil`
     passes, resets failedAttempts), `isActive` gate, and the **no-plaintext-in-logs**
     intercept (capture logger output through a login/hash flow, assert no password
     substring). PAUSE on green.
  2. Session middleware (express-session + connect-mongo). Tests: 12h TTL, sliding expiry,
     logout destroys the session server-side, non-default cookie name, Secure flag under
     NODE_ENV=production.
  3. `requireAuth` (incl. the **per-request `isActive`/`role` recheck**) + `requireOwner`
     middleware. Tests including the active-session-revocation path.
  4. Bootstrap endpoint + the single empty-DB 503 gate middleware (exempting health +
     static). Tests: 503-everywhere-when-empty, bootstrap→404-once-owner-exists, exempt
     routes still reachable.
  5. Login / logout endpoints. Tests: rate-limit + lockout flow, identical message/timing
     for unknown-username vs wrong-password.
  6. User management endpoints (create worker, deactivate, reset password, change own).
     Tests including the self-protection rules (no self-deactivate, last-active-owner guard,
     change-own requires current password).
  7. **Apply auth middleware to EVERY existing route** per the §6 matrix. Note the file
     structure: `imports / purchases / suppliers / expenses / drawer-adjustments /
     daily-close / reports` are uniformly owner → `router.use(requireOwner)` is fine; but
     **`items`, `sales`, and `customers` are mixed-access and MUST use per-route
     middleware** (e.g. `items` list = requireAuth but `negative-stock`/`adjust`/mutations =
     requireOwner; `sales` create/list = requireAuth but `void` = requireOwner; `customers`
     create/payments = requireAuth but edit/deactivate = requireOwner). Produce the
     **enumerated guard test** (the spec's load-bearing verification): it lists every route
     in every router file with its expected guard and asserts the actual mounted middleware
     stack matches — so a future route added without a guard fails the suite.
  8. The migration script + bootstrap-time invocation, over the **10 enumerated collections
     in §6**. Tests including idempotency (second run is a no-op) and a regression: a sale
     created before this spec has a valid `createdBy` → real User after migration.
  9. **Production serving**: `express.static('frontend/dist')` + SPA fallback (non-`/api`,
     non-static GET → `index.html`), mounted so it doesn't shadow `/api` or the 503 gate.
     Vite proxy stays dev-only.
  10. PAUSE on green. Verify backend slice with curl: bootstrap → login → call protected
      endpoint → logout → call protected endpoint fails.
  11. Frontend: **`AuthContext` + `useAuth()` (React context, no new dep)**, login page,
      bootstrap setup page, profile page, user management page (owner-only), logout button
      in nav, role-based nav hiding, apiClient 401 → clear context + redirect to /login,
      route guards.
  12. Browser verification: full flow end-to-end. Bootstrap → login as owner → create
      worker → log out → log in as worker → try to access /reports (should 403 + UI
      hides it) → log out → log in as owner → deactivate worker → try to log in as
      worker (should fail) AND, with a still-open worker session, confirm the next request
      is 401 (active-session revocation).
  13. The "manual review for plaintext passwords in logs" pass, plus the test that
      asserts no password substring appears in intercepted logger output.
- ADR-014 and ADR-015 are written WITH this spec (same commit), not after ship. After ship:
  PROJECT_PLAN.md + CLAUDE.md updated to mark Phase 8 SHIPPED. The "real auth" TODO in
  CLAUDE.md gets removed (it was the longest-standing TODO in the project).
- The actual deployment is a SEPARATE step after this spec ships. Don't combine them.
  Ship auth, verify in browser locally with real users + real role gates, THEN deploy.
  Deploying before this is verified is the worst time to discover a problem.