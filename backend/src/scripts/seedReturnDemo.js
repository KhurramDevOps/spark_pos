/**
 * Seed data to exercise the supplier-return flow (spec 003b) in the UI:
 *   - a supplier
 *   - an item
 *   - a CREDIT purchase: 100 @ ₹100  -> avgCost ₹100, you owe the supplier ₹10,000
 * Then in Suppliers → (this supplier) → Record return, return some qty and watch:
 *   - the item's stock drop, avgCost stay ₹100 (return removes at current average),
 *   - the supplier balance fall by the return value (or go negative = refund due).
 *
 * Run:  node --env-file=.env src/scripts/seedReturnDemo.js
 */
import mongoose from "mongoose";
import Category from "../models/Category.js";
import Item from "../models/Item.js";
import Supplier from "../models/Supplier.js";
import { createItem } from "../services/itemService.js";
import { recordPurchase } from "../services/purchaseService.js";
import { decimalToString } from "../lib/decimal.js";

const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sparkpos";
const userId = new mongoose.Types.ObjectId("000000000000000000000001"); // dev user

await mongoose.connect(URI);
try {
  let cat = await Category.findOne({ name: "Demo" });
  if (!cat) cat = await Category.create({ name: "Demo", skuPrefix: "DEMO" });

  const supplier = await Supplier.create({
    name: "Return Demo Supplier",
    phone: "0300-7654321",
    openingBalance: "0",
    balance: "0",
  });

  const { item } = await createItem(
    { name: "Return Demo Wire", categoryId: cat._id, baseUnit: "gaz", retailPrice: 18000 },
    { userId }
  );

  await recordPurchase(
    { paymentType: "credit", supplierId: supplier._id, lines: [{ itemId: item._id, qty: "100", unitCost: "10000" }] },
    { userId }
  );
  const afterItem = await Item.findById(item._id);
  const afterSupplier = await Supplier.findById(supplier._id);

  console.log("\nSeeded supplier-return demo:");
  console.log(`  supplier : ${supplier.name}  id=${supplier._id}`);
  console.log(`  item     : ${item.name} (${item.sku})  id=${item._id}`);
  console.log(`  purchase : CREDIT 100 @ ₹100 -> stock ${decimalToString(afterItem.stockQty)}, avg ₹${decimalToString(afterItem.avgCost) / 100}`);
  console.log(`  balance  : owe ₹${decimalToString(afterSupplier.balance) / 100}`);
  console.log("\nNow: Suppliers → Return Demo Supplier → Record return. Return e.g. 30 →");
  console.log("  stock 100→70, avg stays ₹100, balance ₹10,000→₹7,000.\n");
} finally {
  await mongoose.disconnect();
}
