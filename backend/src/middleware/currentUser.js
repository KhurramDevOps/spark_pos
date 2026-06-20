import mongoose from "mongoose";

// PLACEHOLDER until real auth (out of scope for spec 001). StockMovement.createdBy
// is required for the audit trail, so we attach a fixed dev user id for now.
// Replace with the authenticated user once login exists.
const DEV_USER_ID = process.env.DEV_USER_ID || "000000000000000000000001";

export function currentUser(req, res, next) {
  req.userId = new mongoose.Types.ObjectId(DEV_USER_ID);
  next();
}
