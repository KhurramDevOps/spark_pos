import Sale from "../models/Sale.js";
import CustomerReturn from "../models/CustomerReturn.js";
import Expense from "../models/Expense.js";
import Customer from "../models/Customer.js";
import Supplier from "../models/Supplier.js";
import Item from "../models/Item.js";
import { resolveWindow, eachKarachiDay, karachiYMDLabel } from "../lib/businessDay.js";
import { aggregateCashFlows } from "./dailyCloseService.js";
import { add, subtract, multiply, divide, decimalToString, isZero, isNegative, HALF_UP } from "../lib/decimal.js";
import { serializeImage } from "../lib/imageUrl.js";

const inRange = (start, end) => ({ createdAt: { $gte: start, $lte: end } });

async function sumField(Model, match, field) {
  const r = await Model.aggregate([{ $match: match }, { $group: { _id: null, s: { $sum: `$${field}` } } }]);
  return r.length ? decimalToString(r[0].s) : "0";
}

/**
 * Revenue NET of returns for a window (spec 006 §6) — NEW in 006 (005 only summed
 * cash-payment sales). All non-voided sales (any paymentType) minus the refund
 * value of returns that happened in the window. A return inside the window lowers
 * revenue even if its original sale is outside it (returns are unscoped to sales).
 */
export async function aggregateRevenue({ start, end }) {
  const range = inRange(start, end);
  const sales = await sumField(Sale, { voided: false, ...range }, "total");
  const refunds = await sumField(CustomerReturn, range, "total");
  return subtract(sales, refunds);
}

/** Revenue + grossProfit + expenses + net for a window. Profit/expenses reuse the
 *  005 aggregation verbatim (single profit code path → trend reconciles to headline). */
export async function windowTotals(range) {
  const [revenue, flows] = await Promise.all([aggregateRevenue(range), aggregateCashFlows(range)]);
  return {
    revenue,
    grossProfit: flows.grossProfit,
    expenses: flows.expenses,
    net: subtract(flows.grossProfit, flows.expenses),
    // spec 008: revenue from quick (uncatalogued) lines — included in `revenue`
    // above, but called out so the headline can show the cost-untracked portion.
    quickSalesRevenue: flows.quickSalesRevenue,
  };
}

/** Signed delta + percentage of cur vs prior. pct is null when prior is zero
 *  (no division by zero — frontend renders "—" / grey). */
function delta(cur, prior) {
  const abs = subtract(cur, prior);
  const pct = isZero(prior) ? null : divide(multiply(abs, "100"), prior, 1, HALF_UP);
  return { abs, pct, priorZero: isZero(prior) };
}

/** Per-day profit/revenue/expenses across the window, bucketed by Karachi day.
 *  Implemented as a per-day loop over aggregateCashFlows + aggregateRevenue rather
 *  than a $group-by-day: it reuses the exact 005 profit/return-netting code (which
 *  is non-trivial JS, not a plain $sum), so the trend can never disagree with the
 *  headline. At this volume a handful-of-dozens of cheap queries is fine. */
export async function aggregateTrend(range) {
  const days = eachKarachiDay(range);
  return Promise.all(
    days.map(async (d) => {
      const t = await windowTotals(d);
      return { date: karachiYMDLabel(d.start), revenue: t.revenue, profit: t.grossProfit, expenses: t.expenses };
    })
  );
}

/** Build a {saleId:itemId -> {price, cost}} lookup for the originals of given
 *  returns — UNSCOPED by window, so a return on an out-of-window sale still nets
 *  correctly (spec 006 §6 / claim C). */
async function originalSaleLines(returns) {
  const saleIds = [...new Set(returns.map((r) => String(r.saleId)))];
  const retSales = await Sale.find({ _id: { $in: saleIds } }).select("lines").lean();
  const byKey = new Map();
  for (const s of retSales) {
    for (const l of s.lines) {
      if (l.kind === "quick") continue; // quick lines aren't returnable (spec 008) — no cost to reverse
      byKey.set(`${s._id}:${l.itemId}`, { price: decimalToString(l.unitPrice), cost: decimalToString(l.costAtTime) });
    }
  }
  return byKey;
}

/**
 * Per-item qty/revenue/grossProfit for the window, netting returns (spec 006 §6).
 * qty = sold − returned; revenue = sale lineTotals − refund value; profit =
 * per-line sale profit − per-line reversed profit. Joined to Item for name/sku/stock.
 * Returns rows sorted by grossProfit desc + the set of itemIds that genuinely sold.
 */
export async function aggregateItemPerformance({ start, end }) {
  const range = inRange(start, end);
  const sales = await Sale.find({ voided: false, ...range }).select("lines").lean();
  const returns = await CustomerReturn.find(range).select("saleId lines").lean();

  const acc = new Map(); // itemId -> { qty, revenue, profit }
  const bump = (id, qty, revenue, profit) => {
    const k = String(id);
    const cur = acc.get(k) ?? { qty: "0", revenue: "0", profit: "0" };
    acc.set(k, {
      qty: add(cur.qty, qty),
      revenue: add(cur.revenue, revenue),
      profit: add(cur.profit, profit),
    });
  };

  const soldItemIds = new Set();
  for (const s of sales) {
    for (const l of s.lines) {
      if (l.kind === "quick") continue; // spec 008: uncatalogued, no per-item row, no cost=0 profit
      soldItemIds.add(String(l.itemId));
      const qty = decimalToString(l.qty);
      const lineProfit = multiply(subtract(decimalToString(l.unitPrice), decimalToString(l.costAtTime)), qty);
      bump(l.itemId, qty, decimalToString(l.lineTotal), lineProfit);
    }
  }

  if (returns.length) {
    const byKey = await originalSaleLines(returns);
    for (const r of returns) {
      for (const l of r.lines) {
        const qty = decimalToString(l.qty);
        const refund = multiply(decimalToString(l.valueAtTime), qty); // price the customer got back
        const m = byKey.get(`${r.saleId}:${l.itemId}`);
        const reversedProfit = m ? multiply(subtract(m.price, m.cost), qty) : "0";
        // Subtract: returns reduce qty, revenue, and profit for the window they fall in.
        bump(l.itemId, multiply(qty, "-1"), multiply(refund, "-1"), multiply(reversedProfit, "-1"));
      }
    }
  }

  const ids = [...new Set([...acc.keys(), ...soldItemIds])];
  const items = await Item.find({ _id: { $in: ids } }).select("name sku stockQty image").lean();
  const meta = new Map(items.map((i) => [String(i._id), i]));

  const rows = [...acc.entries()].map(([id, v]) => {
    const m = meta.get(id);
    return {
      itemId: id,
      name: m?.name ?? "(deleted item)",
      sku: m?.sku ?? "",
      image: serializeImage(m?.image ?? null), // thumbnail in Reports (spec 006b); url resolved (ADR-012)
      qtySold: v.qty,
      revenue: v.revenue,
      grossProfit: v.profit,
      stock: m ? decimalToString(m.stockQty) : "0",
    };
  });
  rows.sort((a, b) => Number(b.grossProfit) - Number(a.grossProfit));
  return { rows, soldItemIds };
}

/**
 * Dead stock: items with current stock > 0 that did NOT sell in the window
 * (spec 006 §6). Voided-aware: `soldItemIds` comes from non-voided sales only, so
 * an item whose only in-window sale was voided counts as dead.
 */
export async function aggregateDeadStock(range, soldItemIds) {
  const sold = soldItemIds ?? (await aggregateItemPerformance(range)).soldItemIds;
  const items = await Item.find().select("name sku stockQty").lean();
  return items
    .filter((i) => !isZero(decimalToString(i.stockQty)) && !isNegative(decimalToString(i.stockQty)) && !sold.has(String(i._id)))
    .map((i) => ({ itemId: String(i._id), name: i.name, sku: i.sku, stock: decimalToString(i.stockQty) }));
}

/** Expense totals by category for the window (sum equals the headline Expenses). */
export async function aggregateExpenseBreakdown({ start, end }) {
  const r = await Expense.aggregate([
    { $match: inRange(start, end) },
    { $group: { _id: "$category", total: { $sum: "$amount" } } },
  ]);
  return r.map((x) => ({ category: x._id, total: decimalToString(x.total) })).sort((a, b) => Number(b.total) - Number(a.total));
}

/** Top-N by ABSOLUTE balance, split into owed (positive) and credit (negative),
 *  sign preserved (spec 006 §6). Reads the cached balance — never re-derived (ADR-011). */
function rankBalances(docs, n = 10) {
  const owed = [];
  const credit = [];
  for (const d of docs) {
    const bal = decimalToString(d.balance);
    if (isZero(bal)) continue;
    const row = { id: String(d._id), name: d.name, balance: bal };
    (isNegative(bal) ? credit : owed).push(row);
  }
  const byAbs = (a, b) => Math.abs(Number(b.balance)) - Math.abs(Number(a.balance));
  return { owed: owed.sort(byAbs).slice(0, n), credit: credit.sort(byAbs).slice(0, n) };
}

export async function aggregateKhata() {
  const [customers, suppliers] = await Promise.all([
    Customer.find().select("name balance").lean(),
    Supplier.find().select("name balance").lean(),
  ]);
  return { customers: rankBalances(customers), suppliers: rankBalances(suppliers) };
}

/**
 * The whole reports payload for one window in one shape (spec 006 §4) — composed
 * for the single /reports endpoint and for Phase-7 AI reuse. Read-only; presentation-free.
 * @param {{window:string,start?:string,end?:string}} input
 * @param {Date} [now] injectable clock (tests)
 */
export async function getReport(input, now = new Date()) {
  const { start, end, prior } = resolveWindow(input, now);
  const range = { start, end };

  const [totals, priorTotals, trend, itemPerf, expenseBreakdown, khata] = await Promise.all([
    windowTotals(range),
    windowTotals(prior),
    aggregateTrend(range),
    aggregateItemPerformance(range),
    aggregateExpenseBreakdown(range),
    aggregateKhata(),
  ]);
  const deadStock = await aggregateDeadStock(range, itemPerf.soldItemIds);

  return {
    window: { ...input, start, end, prior },
    headline: {
      revenue: { value: totals.revenue, delta: delta(totals.revenue, priorTotals.revenue) },
      grossProfit: { value: totals.grossProfit, delta: delta(totals.grossProfit, priorTotals.grossProfit) },
      expenses: { value: totals.expenses, delta: delta(totals.expenses, priorTotals.expenses) },
      net: { value: totals.net, delta: delta(totals.net, priorTotals.net) },
    },
    trend,
    items: itemPerf.rows,
    deadStock,
    expenseBreakdown,
    khata,
  };
}
