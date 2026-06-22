import mongoose from "mongoose";
import Supplier from "../models/Supplier.js";
import SupplierPayment from "../models/SupplierPayment.js";
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
 * Create a supplier. `balance` starts equal to `openingBalance` (spec 003 §5),
 * then runs as credit purchases (+) and payments (−) move it.
 * @param {object} input - { name, phone?, openingBalance? (paisa string) }
 */
export async function createSupplier({ name, phone, openingBalance = "0" }) {
  const ob = toDecimal128(openingBalance, "openingBalance");
  return Supplier.create({ name, phone, openingBalance: ob, balance: ob });
}

/** List suppliers, optionally filtered by active state; sorted by name. */
export async function listSuppliers({ active } = {}) {
  const query = {};
  if (typeof active === "boolean") query.isActive = active;
  return Supplier.find(query).sort({ name: 1 }).collation({ locale: "en", strength: 2 });
}

export async function getSupplier(id) {
  const supplier = await Supplier.findById(id);
  if (!supplier) throw httpError("supplier not found", 404);
  return supplier;
}

/**
 * Edit a supplier's name/phone. openingBalance and balance are NOT editable here:
 * openingBalance is an immutable starting point and balance is a cached running
 * value moved only by purchases/payments in-transaction (spec 003 §5).
 * @param {object} patch - { name?, phone? (string|null) }
 */
export async function updateSupplier(id, patch) {
  const supplier = await Supplier.findById(id);
  if (!supplier) throw httpError("supplier not found", 404);
  if (patch.name !== undefined) supplier.name = patch.name;
  if (patch.phone !== undefined) supplier.phone = patch.phone ?? undefined;
  await supplier.save();
  return supplier;
}

/** Deactivate/reactivate a supplier (soft; never deletes). */
export async function setSupplierActive(id, isActive) {
  const supplier = await Supplier.findById(id);
  if (!supplier) throw httpError("supplier not found", 404);
  supplier.isActive = isActive;
  await supplier.save();
  return supplier;
}

/** Payments recorded against a supplier, newest first. */
export async function listSupplierPayments(supplierId) {
  return SupplierPayment.find({ supplierId }).sort({ date: -1, createdAt: -1 });
}

/**
 * Record a payment to a supplier: write the SupplierPayment AND decrease the
 * supplier's balance, in one transaction. Balance may go negative (advance/
 * overpayment) — allowed and surfaced, never blocked (spec 003 §6).
 *
 * Amount is in PAISA (rupee→paisa conversion happens at the route boundary).
 * @param {object} input - { supplierId, amount (paisa string > 0), date?, note? }
 * @param {object} ctx - { userId }
 */
export async function recordSupplierPayment(input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");

  const amount = parseDecimal(input.amount, "amount");
  if (isNegative(amount) || isZero(amount)) {
    throw httpError("payment amount must be greater than 0", 400);
  }

  return runInTransaction(async (session) => {
    const supplier = await Supplier.findById(input.supplierId).session(session);
    if (!supplier) throw httpError("supplier not found", 400);

    const [payment] = await SupplierPayment.create(
      [
        {
          supplierId: supplier._id,
          amount: toDecimal128(amount),
          date: input.date ?? new Date(),
          note: input.note,
          createdBy: userId,
        },
      ],
      { session }
    );

    supplier.balance = toDecimal128(subtract(decimalToString(supplier.balance), amount));
    await supplier.save({ session });

    return { payment, supplier };
  });
}
