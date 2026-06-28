import mongoose from "mongoose";
import Item from "../models/Item.js";
import Customer from "../models/Customer.js";
import Sale from "../models/Sale.js";
import CustomerReturn from "../models/CustomerReturn.js";
import StockMovement from "../models/StockMovement.js";
import Settings from "../models/Settings.js";
import {
  parseDecimal,
  decimalToString,
  toDecimal128,
  add,
  subtract,
  multiply,
  round,
  isNegative,
  isZero,
  HALF_EVEN,
} from "../lib/decimal.js";

const negate = (d) => subtract("0", d);

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
 * The server-derived pre-bargain price for a line (paisa string). In wholesale
 * mode use the item's wholesalePrice, falling back to retail when unset — never
 * suggest 0 in wholesale mode (spec 004 §6 / ADR-007). Prices on Item are integer
 * paisa (Number).
 */
function suggestedPriceFor(item, priceMode) {
  const paisa =
    priceMode === "wholesale" && item.wholesalePrice != null
      ? item.wholesalePrice
      : item.retailPrice;
  return String(paisa);
}

/**
 * Record a sale (spec 004): decrease stock and snapshot COGS per line, write a
 * `sale` StockMovement per line, and (if credit) increase the customer's khata
 * balance — all in ONE transaction. A sale does NOT change avgCost; it reads
 * `item.avgCost` in-txn and stores it on the line as `costAtTime` (the COGS basis,
 * locked forever). Posted sales are immutable (spec 004 §6).
 *
 * Money is in PAISA here (rupee→paisa conversion happens at the route boundary).
 *
 * @param {object} input
 *   - date?            Date (defaults now)
 *   - customerId?      required when paymentType === "credit"
 *   - paymentType      "cash" | "credit"
 *   - priceMode        "retail" | "wholesale" (drives the suggested price)
 *   - lines            [{ itemId, qty (decimal string > 0), unitPrice (paisa string >= 0) }]
 *   - note?
 * @param {object} ctx - { userId } (audit; required)
 * @returns {Promise<{ sale: object, customer: object|null }>}
 */
export async function recordSale(input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");

  const { paymentType, priceMode } = input;
  if (paymentType !== "cash" && paymentType !== "credit") {
    throw httpError('paymentType must be "cash" or "credit"', 400);
  }
  if (priceMode !== "retail" && priceMode !== "wholesale") {
    throw httpError('priceMode must be "retail" or "wholesale"', 400);
  }
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) throw httpError("a sale needs at least one line", 400);
  if (paymentType === "credit" && !input.customerId) {
    throw httpError("a credit sale requires a customer (you can't owe from nobody)", 400);
  }

  return runInTransaction(async (session) => {
    const settings = await Settings.getSingleton(session);
    const allowNegative = settings.allowNegativeInventory;

    // Customer (if attached) is loaded and validated inside the transaction.
    let customer = null;
    if (input.customerId) {
      customer = await Customer.findById(input.customerId).session(session);
      if (!customer) throw httpError("customer not found", 400);
      if (!customer.isActive) throw httpError("customer is inactive (reactivate them first)", 400);
    }

    const itemsById = new Map(); // itemId -> item doc (loaded once, reused)
    const removedByItem = new Map(); // itemId -> total qty sold across lines
    const storedLines = [];
    let totalExact = "0";

    for (const [i, line] of lines.entries()) {
      const where = `line ${i + 1}`;

      const qty = parseDecimal(line.qty, `${where} qty`);
      if (isNegative(qty) || isZero(qty)) {
        throw httpError(`${where}: qty must be greater than 0`, 400);
      }
      const unitPrice = parseDecimal(line.unitPrice, `${where} unitPrice`);
      if (isNegative(unitPrice)) {
        throw httpError(`${where}: unitPrice cannot be negative`, 400);
      }
      const lineTotal = multiply(qty, unitPrice); // paisa, full precision
      totalExact = add(totalExact, lineTotal);

      // Quick line (spec 008 / ADR-016): an uncatalogued good typed at checkout.
      // Real revenue, NO cost basis — it stores only name + qty + unitPrice +
      // lineTotal, with NO costAtTime/itemId, touches no Item, and moves no stock.
      // (No costAtTime is the whole point: an unknown cost must not become a 0.)
      if (line.kind === "quick") {
        const name = typeof line.name === "string" ? line.name.trim() : "";
        if (!name) throw httpError(`${where}: a quick-sale line needs a name`, 400);
        storedLines.push({
          kind: "quick",
          name,
          qty: toDecimal128(qty),
          unitPrice: toDecimal128(unitPrice),
          lineTotal: toDecimal128(lineTotal),
        });
        continue;
      }

      // Item line (spec 004): catalogued item — snapshot cost, decrement stock.
      const key = String(line.itemId);
      let item = itemsById.get(key);
      if (!item) {
        item = await Item.findById(line.itemId).session(session);
        if (!item) throw httpError(`${where}: item not found`, 400);
        if (!item.isActive) throw httpError(`${where}: item is inactive (reactivate it first)`, 400);
        itemsById.set(key, item);
      }

      // Snapshot the cost (avgCost now) and the suggested price; the sale does NOT
      // move avgCost. These are the source of truth for this line's profit.
      const costAtTime = decimalToString(item.avgCost);
      const suggestedPrice = suggestedPriceFor(item, priceMode);
      removedByItem.set(key, add(removedByItem.get(key) ?? "0", qty));

      // Snapshot warranty terms (spec 009) the same way costAtTime is snapshotted:
      // frozen onto the immutable line so later item edits never alter a past sale.
      const warranties = (item.warranties ?? []).map((w) => ({
        label: w.label ?? "",
        durationValue: w.durationValue,
        durationUnit: w.durationUnit,
      }));

      storedLines.push({
        kind: "item",
        itemId: item._id,
        qty: toDecimal128(qty),
        unitPrice: toDecimal128(unitPrice),
        suggestedPrice: toDecimal128(suggestedPrice),
        costAtTime: toDecimal128(costAtTime),
        lineTotal: toDecimal128(lineTotal),
        ...(warranties.length > 0 ? { warranties } : {}),
      });
    }

    // Negative-stock gate: compute each item's would-be stock from the SUMMED qty
    // (duplicate lines aggregate) and, when the setting forbids it, reject before
    // any write naming the item.
    const newStockByItem = new Map();
    for (const [key, removed] of removedByItem) {
      const item = itemsById.get(key);
      const newStock = subtract(decimalToString(item.stockQty), removed);
      if (!allowNegative && isNegative(newStock)) {
        throw httpError(
          `not enough stock for "${item.name}" (have ${decimalToString(item.stockQty)}, selling ${removed}) — negative stock is disabled`,
          400
        );
      }
      newStockByItem.set(key, newStock);
    }

    // Apply stock decrements (one write per item).
    for (const [key, newStock] of newStockByItem) {
      const item = itemsById.get(key);
      item.stockQty = toDecimal128(newStock);
      await item.save({ session });
    }

    const total = round(totalExact, 0, HALF_EVEN);

    const [sale] = await Sale.create(
      [
        {
          date: input.date ?? new Date(),
          customerId: input.customerId ?? undefined,
          paymentType,
          priceMode,
          lines: storedLines,
          total: toDecimal128(total),
          note: input.note,
          createdBy: userId,
        },
      ],
      { session }
    );

    // One `sale` StockMovement per ITEM line (negative qty), carrying the cost
    // snapshot as costAtTime (audit symmetry). Qty-only in replay — never moves
    // avgCost. Quick lines (spec 008) have no item/stock, so they get NO movement;
    // a quick-only sale writes zero StockMovements.
    const itemLines = storedLines.filter((l) => l.kind === "item");
    if (itemLines.length > 0) {
      await StockMovement.create(
        itemLines.map((l) => ({
          itemId: l.itemId,
          qty: toDecimal128(negate(decimalToString(l.qty))),
          type: "sale",
          costAtTime: l.costAtTime,
          refId: sale._id,
          createdBy: userId,
        })),
        { session, ordered: true }
      );
    }

    if (paymentType === "credit") {
      customer.balance = toDecimal128(add(decimalToString(customer.balance), total));
      await customer.save({ session });
    }

    return { sale, customer };
  });
}

/**
 * Sale history, filterable by customer, date range, and payment type, newest first.
 * @param {object} opts - { customerId, from (Date), to (Date), paymentType, page, limit }
 */
export async function listSales({ customerId, from, to, paymentType, createdBy, page = 1, limit = 20 } = {}) {
  const query = {};
  if (customerId) query.customerId = customerId;
  if (createdBy) query.createdBy = createdBy;
  if (paymentType) query.paymentType = paymentType;
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = from;
    if (to) query.date.$lte = to;
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const [sales, total] = await Promise.all([
    Sale.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("customerId", "name")
      // Line item names for the history list's "Items" column (current name; items
      // are deactivated, never hard-deleted, so the ref stays resolvable).
      .populate("lines.itemId", "name")
      .lean(),
    Sale.countDocuments(query),
  ]);

  // Annotate each sale with its returns (one bounded query for the page) so the
  // history list can flag returned sales WITHOUT touching the immutable total.
  const ids = sales.map((s) => s._id);
  const agg = ids.length
    ? await CustomerReturn.aggregate([
        { $match: { saleId: { $in: ids } } },
        { $group: { _id: "$saleId", returnedTotal: { $sum: "$total" }, returnCount: { $sum: 1 } } },
      ])
    : [];
  const byId = new Map(agg.map((a) => [String(a._id), a]));
  const annotated = sales.map((s) => {
    const r = byId.get(String(s._id));
    return { ...s, returnedTotal: r ? r.returnedTotal : null, returnCount: r ? r.returnCount : 0 };
  });

  return { sales: annotated, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
}

/** A single sale with its lines' items and the customer populated. */
export async function getSale(id, { restrictToUserId = null } = {}) {
  const sale = await Sale.findById(id)
    .populate("customerId", "name")
    .populate("lines.itemId", "name sku baseUnit bundle");
  if (!sale) throw httpError("sale not found", 404);
  // Workers may only view their own sales (§9.4).
  if (restrictToUserId && String(sale.createdBy) !== String(restrictToUserId)) {
    throw httpError("forbidden", 403);
  }
  return sale;
}
