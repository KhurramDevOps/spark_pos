import mongoose from "mongoose";

/**
 * Connect to MongoDB via Mongoose.
 * Throws if MONGODB_URI is missing or the connection fails — the caller
 * (index.js) decides whether to crash the process.
 */
export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Copy backend/.env.example to backend/.env.");
  }

  await mongoose.connect(uri);
  return mongoose.connection;
}

/**
 * Human-readable connection state, used by the health check so we can prove
 * the DB is actually reachable end to end.
 * mongoose.connection.readyState: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting.
 */
export function dbStatus() {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  return states[mongoose.connection.readyState] ?? "unknown";
}
