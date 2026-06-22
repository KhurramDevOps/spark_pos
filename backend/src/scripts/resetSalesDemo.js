/**
 * Reset the sales side to a clean slate for re-testing khata balances (spec 004).
 *
 *   - delete all Sales, CustomerPayments, Customers
 *   - delete all `sale` StockMovements, then REPLAY each affected item so its
 *     stockQty returns to the true purchase-only value (avg unchanged)
 *   - recreate Rafiq Electronics + Walk-in Khan with a ₹0 balance
 *
 * Items/purchases/suppliers are left intact, so you can immediately ring up a
 * fresh credit sale and watch a customer's khata move from zero.
 *
 * Run:  node --env-file=.env src/scripts/resetSalesDemo.js
 */
import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Customer from "../models/Customer.js";
import CustomerPayment from "../models/CustomerPayment.js";
import StockMovement from "../models/StockMovement.js";
import Item from "../models/Item.js";
import { recalculateItemCost } from "../services/costService.js";
import { createCustomer } from "../services/customerService.js";
import { decimalToString } from "../lib/decimal.js";

const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sparkpos";
const userId = new mongoose.Types.ObjectId("000000000000000000000001"); // dev user

await mongoose.connect(URI);
try {
  // Items touched by sales — recompute these after removing the sale movements.
  const affected = await StockMovement.distinct("itemId", { type: "sale" });

  const s = await Sale.deleteMany({});
  const cp = await CustomerPayment.deleteMany({});
  const cu = await Customer.deleteMany({});
  const mv = await StockMovement.deleteMany({ type: "sale" });

  // Replay each affected item: with sale movements gone, stock returns to the
  // purchase-only truth; avgCost is unchanged (sales never moved it).
  for (const id of affected) {
    const r = await recalculateItemCost(id, { userId });
    const it = await Item.findById(id);
    console.log(`  restored ${it.name}: stock -> ${decimalToString(it.stockQty)} (was drifted by ${r.before.stockQty})`);
  }

  await createCustomer({ name: "Rafiq Electronics", phone: "0300-1112222", openingBalance: "0" });
  await createCustomer({ name: "Walk-in Khan", phone: "0321-3334444", openingBalance: "0" });

  console.log(`\nWiped: ${s.deletedCount} sales, ${cp.deletedCount} payments, ${cu.deletedCount} customers, ${mv.deletedCount} sale movements.`);
  console.log("Recreated customers: Rafiq Electronics, Walk-in Khan (balance ₹0).");
  console.log("\nRe-test: Sales → credit sale to Rafiq of a known amount → his khata = that amount;");
  console.log("record a payment → it drops; overpay → goes 'in credit (you owe them)'.\n");
} finally {
  await mongoose.disconnect();
}
