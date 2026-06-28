# Spec: 010 — Khata balance correction via a recorded adjustment

> Slice 5 of the June-2026 batch. Spec-first because it touches an immutable balance
> and the daily-close cash math — both expensive to get wrong.

- **Status:** done (shipped 2026-06-28) — ADR-018
- **Phase:** post-Phase-6 enhancement
- **Author / date:** Claude Code / 2026-06-28

## 1. Problem / goal

A customer's khata sometimes needs correcting — most often the **opening balance was
entered wrong** (a typo, or the owner mis-remembered the starting udhaar), but also
"we agreed to write off Rs 500", or "I under-recorded an old debt". Today
`Customer.openingBalance` is an **immutable starting point** (it literally says so in
the model) and there is no UI to change a khata balance outside of a real sale or
payment. The owner needs a way to correct the balance that is **auditable and never a
silent edit**.

## 2. User stories

- As the owner, when I realise a customer's khata balance is wrong, I want to record a
  **correction with a reason**, so the balance becomes right *and* there's a visible,
  dated trail of what I changed and why.
- As the owner, I want that correction to **not** count as cash I took in that day — it
  isn't money through the drawer, it's fixing a number.
- As anyone viewing the khata, I want the adjustment to appear in the ledger like any
  other line, so the running balance still adds up.

## 3. Scope

**In scope:**
- A new **`CustomerAdjustment`** collection: a recorded, signed, reason-bearing
  correction to a customer's khata `balance`.
- An owner-only "Record adjustment" action on **Customer Detail**; the adjustment shows
  in the khata ledger with its reason.
- Applying it to `customer.balance` in **one transaction** (mirrors
  `recordCustomerPayment`).
- **Exclusion from all cash math** (daily close) — by construction (new collection the
  cash sum never reads) and asserted by a test.

**Out of scope (explicitly not now):**
- **Editing `openingBalance` in place** — never. The opening balance stays immutable;
  corrections are layered on top as adjustments (this is the whole point).
- **Editing or deleting an adjustment** — a wrong adjustment is fixed by another
  adjustment (append-only, same philosophy as voids/reversals). 
- **Supplier-side adjustments** — the symmetric `SupplierAdjustment` is a future mirror
  (extension point noted), not built here.
- Folding adjustments into Reports profit/COGS — an adjustment is **not** a sale and has
  no cost basis; it only moves the receivable balance.

## 4. UI / flow

**Customer Detail (owner-only action):** a "Record adjustment" button (beside Edit,
owner-gated — workers don't see it). Opens a small form:
- **Direction** toggle: *Increase what they owe* / *Decrease what they owe* (clearer for
  a shopkeeper than a signed number).
- **Amount** (Rs, > 0) — the magnitude.
- **Reason** (required) — e.g. "corrected opening balance: was 5,000, should be 50,000".
- **Date** (optional, defaults today).

On submit → the khata balance moves and a new ledger row appears: **"Adjustment"** with
the reason, a signed amount (amber + for increase, green − for decrease), and the new
running balance. 

**Unhappy paths:** amount ≤ 0 → field error. Empty reason → field error. A decrease that
drives the balance negative is **allowed** (becomes store credit — already surfaced as
"paid in advance"), not blocked.

## 5. Data model changes

New collection **`CustomerAdjustment`** (mirrors `CustomerPayment`'s shape + audit):
- `customerId`: ObjectId ref, required.
- `amount`: Decimal128 **paisa, SIGNED** — positive increases what they owe, negative
  decreases. Non-zero. (Stored signed so the balance math is a single `+=`; the UI's
  direction toggle maps to the sign at the route boundary.)
- `reason`: String, required, trimmed (1–2000).
- `date`: Date, default now (the label date, like payments).
- `createdBy`: ObjectId ref User, required (audit).
- timestamps.

**No change to `Customer.openingBalance`** (stays immutable). `Customer.balance` is
moved in the same transaction that writes the adjustment. **No migration** — purely
additive.

## 6. Business rules (be precise — this is where bugs live)

- **One transaction:** write the `CustomerAdjustment` AND `customer.balance += amount`
  inside one `withTransaction` (golden rule #3), exactly like `recordCustomerPayment`
  (which does `balance -= amount`). Read the customer inside the session.
- **Sign convention:** `balance += amount`. Increase = `+magnitude`, Decrease =
  `−magnitude`. Balance may go negative (store credit) — allowed, surfaced, not blocked
  (consistent with spec 004 §6).
- **NOT cash (the critical rule):** an adjustment is a correction, not money through the
  drawer. The daily-close cash math sums `CustomerPayment` only (ADR-009 line B, via
  `sumField`); `CustomerAdjustment` is a **separate collection it never reads**, so it
  is excluded **by construction**. A test asserts an adjustment does not change a day's
  expected cash. (This is exactly why we do NOT reuse `CustomerPayment`, which *is*
  counted as cash.)
- **Reports stay correct automatically:** the Reports khata snapshot reads the cached
  `Customer.balance` (ADR-011); since the adjustment moves it in-txn, the snapshot
  reflects it with no extra code. Profit/COGS are untouched (not a sale, no cost basis).
- **Ledger:** Customer Detail's `buildLedger` gains a third event kind, `adjustment`
  (`delta = amount`), merged with credit sales (+) and payments (−), ordered by posting
  time, so the running balance stays coherent.
- **Append-only / immutable:** adjustments are never edited or deleted; a mistake is
  corrected by another adjustment.

## 7. Validation rules

Shared Zod `customerAdjustmentSchema`:
- `direction`: enum `["increase", "decrease"]`, required.
- `amount`: rupees string, > 0 (reuse the shared rupee validator; reject 0, >2dp,
  separators — same rule as payments).
- `reason`: string, trimmed, required, 1–2000.
- `date`: coerce date, optional.

The route boundary converts `{ direction, amount(rupees) }` → a signed paisa string
(`increase → +`, `decrease → −`) before the service, which works purely in signed paisa.

## 8. Acceptance criteria (checklist)

- [ ] Owner can record an increase and a decrease with a reason; balance moves by the
      signed amount; opening balance is untouched.
- [ ] The adjustment + balance move happen in **one transaction** (roll back together).
- [ ] **A recorded adjustment does NOT change daily-close expected cash** (asserted).
- [ ] Reports khata receivable reflects the adjusted balance (reads cached balance).
- [ ] The adjustment appears in the Customer Detail khata ledger with its reason and a
      correct running balance.
- [ ] A decrease may drive the balance negative (store credit) — allowed + surfaced.
- [ ] Create is **owner-only**; the new routes are registered in the ADR-015 guard test.
- [ ] amount ≤ 0 and empty reason are rejected (Zod, both ends).
- [ ] Works fully through the UI with no AI.

## 9. Open questions — RESOLVED (2026-06-28)

1. **Direction UI → Increase / Decrease toggle** + a positive Rs amount, mapped to
   signed paisa at the route boundary. (Least error-prone for a shopkeeper.)
2. **Permissions → owner-only create, all-view.** Create route owner-gated; list route
   auth-only (workers see it in the ledger). Matches the Edit-customer pattern.
3. **Reason required** on every adjustment — yes (it's the audit trail).
4. **ADR-018 — yes.** Records "khata corrections are recorded adjustments excluded from
   cash, never edits to the immutable opening balance" (parallels ADR-009 cash-vs-
   correction + ADR-007 immutability).

## 10. Notes / decisions

- Deliberately **not** `CustomerPayment` — that collection is counted as drawer cash
  (ADR-009). The new collection is the cash/correction firewall.
- Structurally mirrors `CustomerPayment` (model + service `runInTransaction` + a
  list/record pair + ledger row), so the new surface is small and uses tested patterns.
- Extension point: `SupplierAdjustment` is the obvious symmetric future need (correct a
  supplier's payable) — a later spec, same shape, excluded from cash the same way.
