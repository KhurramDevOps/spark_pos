import mongoose from "mongoose";

import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import StockMovement from "../models/StockMovement.js";
import CustomerPayment from "../models/CustomerPayment.js";
import SupplierPayment from "../models/SupplierPayment.js";
import CustomerReturn from "../models/CustomerReturn.js";
import SupplierReturn from "../models/SupplierReturn.js";
import DrawerAdjustment from "../models/DrawerAdjustment.js";
import Expense from "../models/Expense.js";
import ImportLog from "../models/ImportLog.js";
import { DEV_USER_ID } from "../middleware/currentUser.js";

// The 10 collections that carry a `createdBy` (spec 007 §6). Enumerated on
// purpose — NOT a "scan every collection" — so a new collection can't be
// silently swept by this one-time migration.
const COLLECTIONS = [
  Sale,
  Purchase,
  StockMovement,
  CustomerPayment,
  SupplierPayment,
  CustomerReturn,
  SupplierReturn,
  DrawerAdjustment,
  Expense,
  ImportLog,
];

/**
 * Re-point every pre-auth record stamped with the placeholder `createdBy` at the
 * real bootstrap owner (spec 007 §6, blocker 5). Run once, at bootstrap.
 *
 * Idempotent: it matches only the placeholder id, so a second run finds nothing
 * (modifiedCount 0). Safe to call at the migration-function level even though
 * bootstrap itself can only happen once (the gate 404s a second bootstrap).
 *
 * Returns a per-collection breakdown plus the total modified.
 */
export async function migrateLegacyCreatedBy(ownerId, session = null) {
  const placeholder = new mongoose.Types.ObjectId(DEV_USER_ID);
  const byCollection = {};
  let total = 0;

  for (const Model of COLLECTIONS) {
    const r = await Model.updateMany(
      { createdBy: placeholder },
      { $set: { createdBy: ownerId } },
      session ? { session } : {}
    );
    byCollection[Model.collection.name] = r.modifiedCount;
    total += r.modifiedCount;
  }

  return { total, byCollection };
}
