import { LocalDiskDriver } from "./localDiskDriver.js";
import { S3Driver } from "./s3Driver.js";

/** Pick a storage driver by name (defaults to STORAGE_DRIVER env, then "local"). */
export function createDriver(name = process.env.STORAGE_DRIVER || "local") {
  if (name === "local") return new LocalDiskDriver();
  if (name === "s3") return new S3Driver();
  throw new Error(`unknown STORAGE_DRIVER "${name}" (expected "local" or "s3")`);
}

// The process-wide driver instance the app uses.
export const storage = createDriver();

export { LocalDiskDriver, S3Driver };
