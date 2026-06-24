# Spec: 007 — Authentication & users (Phase 8, pre-deployment)

- **Status:** draft (pending review)
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
- **Session mechanism**: **HTTP-only, secure, SameSite=Strict cookies** with a server-side
  session store (express-session backed by MongoStore, OR a signed JWT with short TTL —
  decide in review; leaning sessions because they're simpler to invalidate on logout/role
  change, and the API and frontend will share an origin in production). 12-hour TTL with
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
  resets workers' passwords. Owner resets own password... see §9 open question.

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
- **Sessions** (if going the express-session route): stored in a `sessions` collection
  via `connect-mongo`. Auto-created by the library; not modeled by hand. If going JWT
  route: no collection, signing key stored in env var (see §6).
- **Migration**: one-time script run after bootstrap that finds all existing records with
  the placeholder `createdBy` ObjectId and updates them to point at the newly-created
  bootstrap owner's `_id`. Runs once, idempotent, no-op on second run.

## 6. Business rules
- **Password hashing**: `bcrypt` with cost factor 12, or `argon2id` with sensible
  defaults. Pick one in review. Whichever — never store plaintext, never store with a
  fast hash, never store with a homegrown algorithm. Compare via the library's
  constant-time `compare` function.
- **Username comparison**: case-insensitive on login (`ahmed` and `Ahmed` are the same
  user). Stored lowercase. Display can be whatever the user typed at create time (stored
  separately as `displayName` — confirm in review; leaning no, just lowercase username,
  display = username).
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
  | Record customer payment | ✅ | ✅ |
  | View Inventory (read-only) | ✅ | ✅ |
  | Edit/Add/Delete inventory items | ✅ | ❌ |
  | CSV import / opening stock / repair tool | ✅ | ❌ |
  | View Sales History | ✅ | ✅ (own sales only) |
  | Void a sale | ✅ | ❌ |
  | Record a customer return | ✅ | ❌ (confirm in review) |
  | View Suppliers + record purchases + supplier payments | ✅ | ❌ |
  | View Daily Close | ✅ | ❌ |
  | Record expense / drawer adjustment | ✅ | ❌ |
  | View Reports | ✅ | ❌ |
  | View Negative Stock | ✅ | ❌ |
  | Create / deactivate / reset worker accounts | ✅ | ❌ |
  | View other users | ✅ | ❌ |
  Confirm the rows marked "confirm" in §9.

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
- **Login rate limiting**: 5 failed attempts within a 15-minute rolling window per
  username → lockout for 15 minutes (lockedUntil = now + 15 min). Successful login
  resets failedAttempts to 0. The lockout error message says generically "Too many
  failed attempts. Try again later." — never confirms whether the username exists.
- **Username enumeration**: login error for "wrong username" and "wrong password" must
  be the same message and same response time (or close enough). Standard practice.
- **No password printed, logged, or stored anywhere**. Not in error messages, not in
  console.log, not in audit logs, not in error stack traces. Reviewed in code.
- **Bootstrap flow**: at app startup, if `users` collection is empty, the only available
  route is `GET /bootstrap` (the setup screen) and `POST /bootstrap` (create the first
  owner). All other routes return 503 "Setup required." Once an owner exists, bootstrap
  routes become 404.
- **Frontend**: a single auth context (Zustand store, mirroring the existing pattern)
  holds the current user (id, username, role, isActive). All screen-level routing checks
  the user's role before rendering. The fetch wrapper (`apiClient`) attaches cookies
  automatically (already happens for same-origin); on a 401 response it redirects to
  `/login` and clears the auth context.
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
- [ ] Every existing endpoint requires authentication except: bootstrap, login.
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
- [ ] Password hashing uses bcrypt (or argon2id), cost factor 12 (or argon2 defaults).
- [ ] Username comparison is case-insensitive (`Ahmed`, `ahmed`, `AHMED` are the same
      account at login).
- [ ] Frontend auth context populates on login, clears on logout, redirects to /login
      on 401.
- [ ] Nav bar hides items the current role can't access (worker doesn't see Reports /
      Daily Close / Suppliers / etc. in the nav).
- [ ] On the deployed environment, the session cookie has Secure=true (regression: env
      var NODE_ENV=production triggers it).

## 9. Open questions (resolve in review — keep this list SHORT, time-sensitive)
1. **bcrypt vs argon2id**. Both are correct choices. bcrypt is in more Node tutorials
   and battle-tested; argon2id is technically newer/better and a current best practice.
   Leaning bcrypt (cost 12) — wider ecosystem familiarity, simpler review for
   correctness. Confirm.
2. **Session vs JWT**. Sessions = simpler revocation (logout, role change, lockout all
   work cleanly server-side), but require a session store. JWT = stateless, but
   revocation requires either a blacklist (defeats stateless) or short TTLs. Leaning
   sessions with `express-session` + `connect-mongo`, since we already have MongoDB and
   we want clean revocation. Confirm.
3. **Can workers record customer returns?** Returns affect cash/khata, but they're a
   normal customer-service operation. Owner-only feels overly restrictive in a real
   shop. Leaning worker-yes for returns, owner-only for voids. Confirm with the actual
   shop policy.
4. **Worker sees Sales History — all sales, or only their own?** Leaning "only own"
   for privacy (a worker doesn't need to see what other workers sold). Confirm.
5. **If the owner forgets their own password — what's the recovery path?**
   Realistic options:
   (a) A documented command-line script run on the server: `node
       scripts/reset-owner-password.js` that prompts for a new password. Requires server
       access. v1-acceptable.
   (b) A second owner account who can reset the first owner's password — but §4 says
       owners can't create owners, so this would need rework. Probably no.
   (c) Email-based reset — out of scope per §4.
   Leaning (a) — single-shop, owner has access to the server, this is the realistic path.
   Confirm.
6. **The migration step for existing `createdBy` placeholders.** Currently every record
   has a placeholder ObjectId. After bootstrap, are those records re-pointed at the
   bootstrap owner? The alternative is leaving them as-is and accepting that pre-auth
   data shows "system" in audit displays. Leaning re-point — owner's name on legacy
   records is more useful than "system." Confirm.

## 10. Notes / decisions
- **Deployment checklist** (this spec doesn't ship without these in place):
  - HTTPS configured on the deployment platform. Without it, secure cookies break and
    sessions don't survive page loads.
  - `SESSION_SECRET` env var set to a long, random, secret string (32+ chars, never
    committed). Generate with `openssl rand -base64 48`.
  - `NODE_ENV=production` set.
  - `MONGODB_URI` points at the production Atlas database.
  - First-run bootstrap completed (owner account created) before any external user
    can hit the URL.
  - The migration script for legacy `createdBy` runs as part of bootstrap.
- **ADR-014 to write alongside this spec**: "Auth uses session cookies (HTTP-only,
  Secure, SameSite=Strict) backed by a server-side store; passwords are hashed with
  bcrypt cost 12 (or argon2id, depending on §9.1 resolution); no plaintext passwords
  anywhere; role enum stays at owner | worker with a fixed capability matrix; bootstrap
  is the only path to creating the first owner." Same voice as 009/010/011/012/013.
- **ADR-015 might also land here**: "All deployed endpoints require authentication
  except bootstrap and login; deployment without auth in front of every other endpoint
  is forbidden." This is the architectural invariant that this spec creates and that
  must be preserved by every future spec.
- **Build order** (every step has owner verification before the next):
  1. User model + Zod + tests (hash on create, never echo password back, username
     case-insensitive uniqueness).
  2. bcrypt + auth service: createUser, verifyPassword, lockout logic. Tests.
  3. Session middleware (express-session + connect-mongo OR JWT). Tests including TTL,
     sliding expiry, logout.
  4. requireAuth + requireOwner middleware. Tests.
  5. Bootstrap endpoint (only-when-empty, 503-everywhere-else gate). Tests.
  6. Login / logout endpoints. Tests including the rate-limit + lockout flow.
  7. User management endpoints (create worker, deactivate, reset password, change own).
     Tests including the self-protection rules.
  8. **Apply requireAuth + requireOwner to EVERY existing route** per the §6 matrix.
     Tests that workers get 403 on owner-only endpoints, that no endpoint is
     accidentally unprotected.
  9. The migration script + bootstrap-time invocation. Tests including idempotency.
  10. PAUSE on green. Verify backend slice with curl: bootstrap → login → call
      protected endpoint → logout → call protected endpoint fails.
  11. Frontend: auth context (Zustand), login page, bootstrap setup page, profile page,
      user management page (owner-only), logout button in nav, role-based nav hiding,
      apiClient 401 → redirect to /login, route guards.
  12. Browser verification: full flow end-to-end. Bootstrap → login as owner → create
      worker → log out → log in as worker → try to access /reports (should 403 + UI
      hides it) → log out → log in as owner → deactivate worker → try to log in as
      worker (should fail).
  13. The "manual review for plaintext passwords in logs" pass, plus the test that
      asserts no password substring appears in intercepted logger output.
- After ship: ADR-014 (+ ADR-015 if going that route) written. PROJECT_PLAN.md + CLAUDE.md
  updated to mark Phase 8 SHIPPED. The "real auth" TODO in CLAUDE.md gets removed (it
  was the longest-standing TODO in the project).
- The actual deployment is a SEPARATE step after this spec ships. Don't combine them.
  Ship auth, verify in browser locally with real users + real role gates, THEN deploy.
  Deploying before this is verified is the worst time to discover a problem.