/**
 * One-time (idempotent) initiation of the local single-node replica set.
 *
 * MongoDB multi-document transactions require a replica set. Locally we run a
 * single-node set named `rs0` (see backend/README.md). This script connects
 * directly to the standalone-looking member and runs `replSetInitiate`. Run it
 * once after first enabling `replSetName` in mongod.conf:
 *
 *   node src/scripts/initReplicaSet.js
 *
 * Safe to re-run: if the set is already initiated it reports that and exits 0.
 */
import mongoose from "mongoose";

const HOST = process.env.MONGO_HOST || "127.0.0.1:27017";
const REPL_SET = process.env.MONGO_REPL_SET || "rs0";

async function main() {
  // directConnection is required: the set isn't initiated yet, so the driver
  // must not try to discover a primary.
  await mongoose.connect(`mongodb://${HOST}/?directConnection=true`);
  const admin = mongoose.connection.db.admin();

  const config = {
    _id: REPL_SET,
    members: [{ _id: 0, host: HOST }],
  };

  try {
    await admin.command({ replSetInitiate: config });
    console.log(`[rs] initiated replica set "${REPL_SET}" with member ${HOST}`);
  } catch (err) {
    // 23 = AlreadyInitialized. Anything else is a real failure.
    if (err.code === 23 || /already initialized/i.test(err.message)) {
      console.log(`[rs] replica set "${REPL_SET}" already initiated — nothing to do`);
    } else {
      throw err;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("[rs] initiation failed:", err.message);
  process.exit(1);
});
