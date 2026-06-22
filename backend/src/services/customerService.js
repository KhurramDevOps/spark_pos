import mongoose from "mongoose";
import Customer from "../models/Customer.js";
import CustomerPayment from "../models/CustomerPayment.js";
import {
  parseDecimal,
  decimalToString,
  toDecimal128,
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
export async function createCustomer({ name, phone, openingBalance = "0" }) {
  const ob = toDecimal128(openingBalance, "openingBalance");
  return Customer.create({ name, phone, openingBalance: ob, balance: ob });
}

/** List customers, optionally filtered by active state; sorted by name. */
export async function listCustomers({ active } = {}) {
  const query = {};
  if (typeof active === "boolean") query.isActive = active;
  return Customer.find(query).sort({ name: 1 }).collation({ locale: "en", strength: 2 });
}

export async function getCustomer(id) {
  const customer = await Customer.findById(id);
  if (!customer) throw httpError("customer not found", 404);
  return customer;
}

/**
 * Edit a customer's name/phone. openingBalance and balance are NOT editable here
 * (immutable starting point + cached running value). Mirrors updateSupplier.
 * @param {object} patch - { name?, phone? (string|null) }
 */
export async function updateCustomer(id, patch) {
  const customer = await Customer.findById(id);
  if (!customer) throw httpError("customer not found", 404);
  if (patch.name !== undefined) customer.name = patch.name;
  if (patch.phone !== undefined) customer.phone = patch.phone ?? undefined;
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
