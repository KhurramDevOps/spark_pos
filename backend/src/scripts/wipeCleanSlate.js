/**
 * Full clean slate for end-of-phase: wipe all transactional + entity data so the
 * shop starts fresh, KEEPING categories and the SKU counters (so real items keep
 * numbering on from where they were) and Settings.
 *
 * Run:  node --env-file=.env src/scripts/wipeCleanSlate.js
 */
import mongoose from "mongoose";

const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sparkpos";

await mongoose.connect(URI);
try {
  const db = mongoose.connection.db;
  const CLEAR = [
    "items", "suppliers", "customers",
    "purchases", "sales",
    "supplierpayments", "customerpayments",
    "supplierreturns", "customerreturns",
    "stockmovements", "importlogs",
    "expenses", "draweradjustments", "daycloses", // Phase 5 (spec 005)
  ];
  const KEEP = ["categories", "counters", "settings"];

  console.log("To be cleared (pre-count):");
  for (const c of CLEAR) {
    console.log(`  ${c}: ${await db.collection(c).countDocuments()}`);
  }

  console.log("\nClearing:");
  for (const c of CLEAR) {
    const r = await db.collection(c).deleteMany({});
    console.log(`  ${c}: deleted ${r.deletedCount}`);
  }
  console.log("Kept (untouched):");
  for (const c of KEEP) console.log(`  ${c}: ${await db.collection(c).countDocuments()}`);
  console.log("\nClean slate ready — categories + SKU counters preserved.\n");
} finally {
  await mongoose.disconnect();
}
