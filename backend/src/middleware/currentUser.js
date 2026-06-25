import mongoose from "mongoose";

// PLACEHOLDER until real auth (out of scope for spec 001). StockMovement.createdBy
// is required for the audit trail, so we attach a fixed dev user id for now.
// Replace with the authenticated user once login exists.
// Exported so the spec-007 bootstrap migration can find every legacy record
// stamped with this placeholder and re-point it at the real bootstrap owner.
export const DEV_USER_ID = process.env.DEV_USER_ID || "000000000000000000000001";
// Role is also a placeholder until real auth (spec 002 gates import to owners).
// The dev user is an owner by default; override with DEV_USER_ROLE=worker to test the gate.
const DEV_USER_ROLE = process.env.DEV_USER_ROLE || "owner";

export function currentUser(req, res, next) {
  req.userId = new mongoose.Types.ObjectId(DEV_USER_ID);
  req.userRole = DEV_USER_ROLE;
  next();
}
