import mongoose from "mongoose";
import Customer from "../models/Customer.js";
import CustomerPayment from "../models/CustomerPayment.js";
import CustomerAdjustment from "../models/CustomerAdjustment.js";
import {
  parseDecimal,
  decimalToString,
  toDecimal128,
  add,
  subtract,
  isNegative,
  isZero,
} from "../lib/decimal.js";

/** Run `fn(session)` inside a single MongoDB transaction (golden rule #3). */
async function runInTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Create a customer. `balance` starts equal to `openingBalance` (spec 004 §5),
 * then runs as credit sales (+) and payments (−) move it. Mirrors createSupplier.
 * @param {object} input - { name, phone?, openingBalance? (paisa string) }
 */
export async function createCustomer({ name, phone, openingBalance = "0", promisedPayBy = null }) {
  const ob = toDecimal128(openingBalance, "openingBalance");
  return Customer.create({ name, phone, openingBalance: ob, balance: ob, promisedPayBy });
}

/**
 * Whole-book khata totals (paisa), GLOBAL — independent of any `active` filter on
 * the list, because the receivable is a property of the whole book: a deactivated
 * customer who still owes must count. Reads the cached `Customer.balance` — the same
 * source the Reports khata snapshot uses (ADR-011), so the two always agree.
 *  - toReceive:   Σ balance where balance > 0  (money customers owe the shop)
 *  - storeCredit: Σ |balance| where balance < 0 (advances/credit the shop owes them)
 *  - count:       customers with a non-zero balance ("khata customers")
 */
async function customerKhataTotals() {
  const [t] = await Customer.aggregate([
    {
      $group: {
        _id: null,
        toReceive: { $sum: { $cond: [{ $gt: ["$balance", 0] }, "$balance", 0] } },
        storeCredit: { $sum: { $cond: [{ $lt: ["$balance", 0] }, { $abs: "$balance" }, 0] } },
        count: { $sum: { $cond: [{ $ne: ["$balance", 0] }, 1, 0] } },
      },
    },
  ]);
  return {
    toReceive: decimalToString(t?.toReceive ?? 0),
    storeCredit: decimalToString(t?.storeCredit ?? 0),
    count: t?.count ?? 0,
  };
}

/** Escape user input before using it in a RegExp (matches itemService). */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * List customers, optionally filtered by active state and a case-insensitive name
 * substring (`search`); sorted by name. Returns the list PLUS whole-book khata
 * totals in one round-trip (header tiles read `totals`). The `totals` are GLOBAL —
 * a search narrows the LIST only, never the headline figures.
 */
export async function listCustomers({ active, search } = {}) {
  const query = {};
  if (typeof active === "boolean") query.isActive = active;
  if (search && search.trim()) {
    query.name = new RegExp(escapeRegex(search.trim()), "i");
  }
  const customers = await Customer.find(query)
    .sort({ name: 1 })
    .collation({ locale: "en", strength: 2 });
  return { customers, totals: await customerKhataTotals() };
}

export async function getCustomer(id) {
  const customer = await Customer.findById(id);
  if (!customer) throw httpError("customer not found", 404);
  return customer;
}

/**
 * Edit a customer's name/phone/promised-pay-by date. openingBalance and balance are
 * NOT editable here (immutable starting point + cached running value; corrections go
 * through the adjustment flow). Mirrors updateSupplier.
 * @param {object} patch - { name?, phone? (string|null), promisedPayBy? (Date|null) }
 */
export async function updateCustomer(id, patch) {
  const customer = await Customer.findById(id);
  if (!customer) throw httpError("customer not found", 404);
  if (patch.name !== undefined) customer.name = patch.name;
  if (patch.phone !== undefined) customer.phone = patch.phone ?? undefined;
  // null clears the promise; a Date sets it.
  if (patch.promisedPayBy !== undefined) customer.promisedPayBy = patch.promisedPayBy ?? null;
  await customer.save();
  return customer;
}

/** Deactivate/reactivate a customer (soft; never deletes). */
export async function setCustomerActive(id, isActive) {
  const customer = await Customer.findById(id);
  if (!customer) throw httpError("customer not found", 404);
  customer.isActive = isActive;
  await customer.save();
  return customer;
}

/** Payments recorded against a customer, newest first. */
export async function listCustomerPayments(customerId) {
  return CustomerPayment.find({ customerId }).sort({ date: -1, createdAt: -1 });
}

/**
 * Record a payment received from a customer: write the CustomerPayment AND
 * decrease the customer's khata balance, in one transaction. Balance may go
 * negative (advance — the shop owes them) — allowed and surfaced (spec 004 §6).
 * Mirrors recordSupplierPayment.
 *
 * Amount is in PAISA (rupee→paisa conversion happens at the route boundary).
 * @param {object} input - { customerId, amount (paisa string > 0), date?, note? }
 * @param {object} ctx - { userId }
 */
export async function recordCustomerPayment(input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");

  const amount = parseDecimal(input.amount, "amount");
  if (isNegative(amount) || isZero(amount)) {
    throw httpError("payment amount must be greater than 0", 400);
  }

  return runInTransaction(async (session) => {
    const customer = await Customer.findById(input.customerId).session(session);
    if (!customer) throw httpError("customer not found", 400);

    const [payment] = await CustomerPayment.create(
      [
        {
          customerId: customer._id,
          amount: toDecimal128(amount),
          date: input.date ?? new Date(),
          note: input.note,
          createdBy: userId,
        },
      ],
      { session }
    );

    customer.balance = toDecimal128(subtract(decimalToString(customer.balance), amount));
    await customer.save({ session });

    return { payment, customer };
  });
}

/** Adjustments for one customer, newest first (the khata ledger reads these). */
export async function listCustomerAdjustments(customerId) {
  return CustomerAdjustment.find({ customerId }).sort({ date: -1, createdAt: -1 });
}

/**
 * Record a khata balance correction (spec 010 / ADR-018): write the CustomerAdjustment
 * AND move the customer's balance by the SIGNED amount, in one transaction. This is NOT
 * a payment — it never touches the daily-close cash math (separate collection). Balance
 * may go negative (store credit) — allowed and surfaced. Mirrors recordCustomerPayment.
 *
 * Amount is SIGNED PAISA (the route maps the increase/decrease toggle to the sign).
 * @param {object} input - { customerId, amount (signed paisa string, non-zero), reason, date? }
 * @param {object} ctx - { userId }
 */
export async function recordCustomerAdjustment(input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");

  const amount = parseDecimal(input.amount, "amount");
  if (isZero(amount)) throw httpError("adjustment amount must be greater than 0", 400);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) throw httpError("a reason is required for a khata adjustment", 400);

  return runInTransaction(async (session) => {
    const customer = await Customer.findById(input.customerId).session(session);
    if (!customer) throw httpError("customer not found", 400);

    const [adjustment] = await CustomerAdjustment.create(
      [{ customerId: customer._id, amount: toDecimal128(amount), reason, date: input.date ?? new Date(), createdBy: userId }],
      { session }
    );

    customer.balance = toDecimal128(add(decimalToString(customer.balance), amount));
    await customer.save({ session });

    return { adjustment, customer };
  });
}
