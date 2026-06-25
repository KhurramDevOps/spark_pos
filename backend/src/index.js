import { createApp } from "./app.js";
import { connectDB } from "./db.js";
import { refreshHasUsers } from "./lib/setupState.js";

const PORT = process.env.PORT || 5001;

async function start() {
  try {
    await connectDB();
    console.log("[db] connected to MongoDB");
    // Initialise the bootstrap gate's cache from the DB before serving.
    const ready = await refreshHasUsers();
    console.log(ready ? "[auth] bootstrapped — login required" : "[auth] no users yet — bootstrap required");
  } catch (err) {
    console.error("[db] connection failed:", err.message);
    process.exit(1);
  }

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[api] SparkPOS backend listening on http://localhost:${PORT}`);
  });
}

start();
