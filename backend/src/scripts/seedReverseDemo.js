/**
 * Seed a tiny dataset to exercise the reverse-purchase flow (spec 003b) in the UI:
 *   - one item
 *   - purchase A: 100 @ ₹100  -> avgCost ₹100
 *   - purchase B: 100 @ ₹140  -> avgCost ₹120
 * Then reverse B in the UI and watch avgCost go back to ₹100 (replay excluding B).
 *
 * Run:  node --env-file=.env src/scripts/seedReverseDemo.js
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
    { name: "Reverse Demo Wire", categoryId: cat._id, baseUnit: "gaz", retailPrice: 20000 },
    { userId }
  );

  // unitCost is paisa: ₹100 = 10000, ₹140 = 14000.
  const { purchase: A } = await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "100", unitCost: "10000" }] },
    { userId }
  );
  const afterA = await Item.findById(item._id);

  const { purchase: B } = await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "100", unitCost: "14000" }] },
    { userId }
  );
  const afterB = await Item.findById(item._id);

  console.log("\nSeeded reverse-purchase demo:");
  console.log(`  item       : ${item.name} (${item.sku})  id=${item._id}`);
  console.log(`  purchase A : ${A._id}  100 @ ₹100  -> avg ${decimalToString(afterA.avgCost) / 100} (paisa ${decimalToString(afterA.avgCost)})`);
  console.log(`  purchase B : ${B._id}  100 @ ₹140  -> avg ${decimalToString(afterB.avgCost) / 100} (paisa ${decimalToString(afterB.avgCost)})`);
  console.log("\nNow open Purchases, click purchase B, and Reverse it — avgCost should return to ₹100.\n");
} finally {
  await mongoose.disconnect();
}
