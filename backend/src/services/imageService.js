import sharp from "sharp";
import Item from "../models/Item.js";
import { storage } from "../lib/storage/index.js";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Resize + re-encode an uploaded image to a single canonical JPEG (spec 006b §6):
 * honor EXIF orientation then strip metadata, fit within 800px, quality 80.
 * Output is always JPEG regardless of input. Throws on an undecodable buffer.
 */
export async function resizeToJpeg(buffer) {
  return sharp(buffer)
    .rotate() // apply EXIF orientation; sharp drops metadata on output by default
    .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}

/** Best-effort delete of an upload-backed image's stored file (never throws). */
export async function deleteStoredImageIfUpload(image) {
  if (image?.kind !== "upload") return;
  try {
    await storage.delete(image.ref);
  } catch (err) {
    console.warn(`image cleanup: could not delete ${image.ref}: ${err.message}`);
  }
}

/**
 * Store an uploaded file as the item's image (spec 006b §6). Validates type, resizes,
 * writes via the storage driver, updates Item.image, then deletes the prior upload
 * (best-effort). On a DB save failure the just-written file is rolled back.
 * @param {string} itemId
 * @param {{ buffer: Buffer, mimetype: string }} file - from multer memory storage
 */
export async function setUploadedImage(itemId, file) {
  if (!file) throw httpError("no file uploaded (field 'file')", 400);
  if (!ALLOWED_MIME.has(file.mimetype)) {
    throw httpError("unsupported image type; use JPEG, PNG, or WebP", 400);
  }

  const item = await Item.findById(itemId);
  if (!item) throw httpError("item not found", 404);

  let jpeg;
  try {
    jpeg = await resizeToJpeg(file.buffer);
  } catch {
    throw httpError("could not decode image (corrupt or not a real image)", 400);
  }

  const key = await storage.put(jpeg, String(item._id));
  const previous = item.image;
  item.image = { kind: "upload", ref: key, updatedAt: new Date() };
  try {
    await item.save();
  } catch (err) {
    await storage.delete(key).catch(() => {}); // roll back the orphaned file
    throw err;
  }
  await deleteStoredImageIfUpload(previous);
  return item;
}

/** Remove an item's image (clears the field, best-effort deletes the file). */
export async function removeImage(itemId) {
  const item = await Item.findById(itemId);
  if (!item) throw httpError("item not found", 404);
  const previous = item.image;
  item.image = undefined;
  await item.save();
  await deleteStoredImageIfUpload(previous);
  return item;
}
