import mongoose from "mongoose";

const { Schema } = mongoose;

export const ROLES = ["owner", "worker"];

/**
 * A user of the system (spec 007). Two roles: `owner` (full access) and
 * `worker` (sales-side only — see the §6 capability matrix). The first owner is
 * created by bootstrap and has no `createdBy`; everyone else is created by an
 * owner.
 *
 * Security internals (passwordHash + the lockout counters) are stripped from
 * any JSON serialization so they can never leak through an API response.
 */
const userSchema = new Schema(
  {
    // Stored lowercase + trimmed; unique. Because every write goes through
    // Mongoose (which lowercases), the unique index is effectively
    // case-insensitive: "Ahmed" and "ahmed" collide.
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 32,
    },

    // bcrypt hash — NEVER the plain password. Set only via the auth service.
    passwordHash: { type: String, required: true },

    role: { type: String, required: true, enum: ROLES },

    isActive: { type: Boolean, default: true },

    // The owner who created this account. Null for the bootstrap owner (§4).
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    lastLoginAt: { type: Date, default: null },

    // --- Login lockout state (§6) ---
    // failedAttempts accumulate within a rolling window anchored at
    // failedWindowStartedAt; 5 within 15 min sets lockedUntil. All three reset
    // on a successful login. lockedUntil auto-expires by timestamp (no flag).
    failedAttempts: { type: Number, default: 0 },
    failedWindowStartedAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

// Belt-and-braces: never serialize secrets or lockout internals.
userSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.failedAttempts;
    delete ret.failedWindowStartedAt;
    delete ret.lockedUntil;
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model("User", userSchema);
