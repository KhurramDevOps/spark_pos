/**
 * Create a DRIFTED item to demo the recalculate-cost repair tool (spec 003b).
 *
 * It builds an item with real movement history (two purchases -> true avgCost
 * ₹120, stock 200), then DIRECTLY overwrites the cached avgCost/stockQty with
 * deliberately wrong values — bypassing the movement path, simulating corruption.
 * The movement history stays correct, so Recalculate can catch and fix the drift.
 *
 * Run:  node --env-file=.env src/scripts/corruptItemCost.js
 */
import mongoose from "mongoose";
import Category from "../models/Category.js";
import Item from "../models/Item.js";
import { createItem } from "../services/itemService.js";
import { recordPurchase } from "../services/purchaseService.js";
import { decimalToString } from "../lib/decimal.js";

const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sparkpos";
const userId = new mongoose.Types.ObjectId("000000000000000000000001"); // dev user

await mongoose.connect(URI);
try {
  let cat = await Category.findOne({ name: "Demo" });
  if (!cat) cat = await Category.create({ name: "Demo", skuPrefix: "DEMO" });

  const { item } = await createItem(
    { name: "Drift Demo Wire", categoryId: cat._id, baseUnit: "gaz", retailPrice: 25000 },
    { userId }
  );
  // True history: 100 @ ₹100 then 100 @ ₹140 -> avg ₹120, stock 200.
  await recordPurchase({ paymentType: "cash", lines: [{ itemId: item._id, qty: "100", unitCost: "10000" }] }, { userId });
  await recordPurchase({ paymentType: "cash", lines: [{ itemId: item._id, qty: "100", unitCost: "14000" }] }, { userId });
  const trueState = await Item.findById(item._id);

  // Corrupt the CACHED aggregates directly (no movement) — wrong avg + wrong stock.
  await Item.findByIdAndUpdate(item._id, {
    avgCost: mongoose.Types.Decimal128.fromString("99999"), // ₹999.99
    stockQty: mongoose.Types.Decimal128.fromString("7"),
  });

  console.log("\nCreated a DRIFTED item:");
  console.log(`  item     : ${item.name} (${item.sku})  id=${item._id}`);
  console.log(`  TRUE     : avg ₹${decimalToString(trueState.avgCost) / 100}, stock ${decimalToString(trueState.stockQty)}  (from movements)`);
  console.log(`  CORRUPTED: avg ₹999.99, stock 7  (what the inventory now shows)`);
  console.log("\nInventory shows the wrong numbers. Click Recalc on this item →");
  console.log("  it replays history, reports the drift, and fixes avg back to ₹120 / stock 200.\n");
} finally {
  await mongoose.disconnect();
}
