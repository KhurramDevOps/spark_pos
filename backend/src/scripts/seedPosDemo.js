/**
 * Seed realistic data to exercise the POS sale screen (spec 004). Items get a REAL
 * avgCost via purchases, so below-cost warnings and profit are meaningful.
 *
 *   Fans         : Ceiling Fan      avg ₹7,200  stock 10   (retail ₹9,000 / ws ₹8,200)
 *   Wire & Cable : GM 7/29 Wire     avg ₹90/gaz stock 200  (retail ₹140 / ws ₹125)
 *   Electrical   : 2-Pin Switch     avg ₹45     stock 100  (retail ₹80  / ws ₹65)
 *   Electrical   : LED Bulb         avg ₹0      stock 0    (retail ₹300 / ws ₹250)  ← 0 stock
 *   Customers    : Rafiq Electronics, Walk-in Khan
 *
 * Run:  node --env-file=.env src/scripts/seedPosDemo.js
 */
import mongoose from "mongoose";
import Category from "../models/Category.js";
import Item from "../models/Item.js";
import Customer from "../models/Customer.js";
import { createItem } from "../services/itemService.js";
import { recordPurchase } from "../services/purchaseService.js";
import { decimalToString } from "../lib/decimal.js";

const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sparkpos";
const userId = new mongoose.Types.ObjectId("000000000000000000000001"); // dev user

await mongoose.connect(URI);
try {
  async function category(name, skuPrefix) {
    return (await Category.findOne({ name })) || (await Category.create({ name, skuPrefix }));
  }
  const fans = await category("Fans", "FAN");
  const wire = await category("Wire & Cable", "WIR");
  const elec = await category("Electrical", "ELE");

  // Create an item and stock it via a cash purchase (sets a real avgCost).
  async function stocked({ name, categoryId, baseUnit, retailPrice, wholesalePrice, qty, unitCost }) {
    const { item } = await createItem(
      { name, categoryId, baseUnit, retailPrice, wholesalePrice },
      { userId }
    );
    await recordPurchase(
      { paymentType: "cash", lines: [{ itemId: item._id, qty, unitCost }] },
      { userId }
    );
    return Item.findById(item._id);
  }

  const fan = await stocked({
    name: "Ceiling Fan", categoryId: fans._id, baseUnit: "piece",
    retailPrice: 900000, wholesalePrice: 820000, qty: "10", unitCost: "720000",
  });
  const gmWire = await stocked({
    name: "GM 7/29 Wire", categoryId: wire._id, baseUnit: "gaz",
    retailPrice: 14000, wholesalePrice: 12500, qty: "200", unitCost: "9000",
  });
  const sw = await stocked({
    name: "2-Pin Switch", categoryId: elec._id, baseUnit: "piece",
    retailPrice: 8000, wholesalePrice: 6500, qty: "100", unitCost: "4500",
  });

  // Deliberately 0 stock (no purchase) → test negative sell-through.
  const { item: led } = await createItem(
    { name: "LED Bulb", categoryId: elec._id, baseUnit: "piece", retailPrice: 30000, wholesalePrice: 25000 },
    { userId }
  );

  const rafiq = await Customer.create({ name: "Rafiq Electronics", phone: "0300-1112222", openingBalance: "0", balance: "0" });
  const khan = await Customer.create({ name: "Walk-in Khan", phone: "0321-3334444", openingBalance: "0", balance: "0" });

  const r = (p) => `₹${(Number(p) / 100).toLocaleString("en-PK")}`;
  console.log("\nSeeded POS demo:");
  console.log(`  ${fan.name.padEnd(16)} ${fan.sku}  stock ${decimalToString(fan.stockQty)}  avg ${r(decimalToString(fan.avgCost))}  retail ${r(fan.retailPrice)} / ws ${r(fan.wholesalePrice)}`);
  console.log(`  ${gmWire.name.padEnd(16)} ${gmWire.sku}  stock ${decimalToString(gmWire.stockQty)}  avg ${r(decimalToString(gmWire.avgCost))}/gaz  retail ${r(gmWire.retailPrice)} / ws ${r(gmWire.wholesalePrice)}`);
  console.log(`  ${sw.name.padEnd(16)} ${sw.sku}  stock ${decimalToString(sw.stockQty)}  avg ${r(decimalToString(sw.avgCost))}  retail ${r(sw.retailPrice)} / ws ${r(sw.wholesalePrice)}`);
  console.log(`  ${led.name.padEnd(16)} ${led.sku}  stock 0 (sell-through test)  retail ${r(led.retailPrice)} / ws ${r(led.wholesalePrice)}`);
  console.log(`  customers: ${rafiq.name}, ${khan.name}`);
  console.log("\nOpen Sales → ring up items. Try selling the Ceiling Fan below ₹7,200 to see the below-cost warning,");
  console.log("and sell an LED Bulb (0 stock) to see negative sell-through.\n");
} finally {
  await mongoose.disconnect();
}
