import { createApp } from "./app.js";
import { connectDB } from "./db.js";

const PORT = process.env.PORT || 5001;

async function start() {
  try {
    await connectDB();
    console.log("[db] connected to MongoDB");
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
