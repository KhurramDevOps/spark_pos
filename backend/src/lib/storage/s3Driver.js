import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

/**
 * S3/object-storage driver (ADR-012), targeting Cloudflare R2 via the S3-compatible
 * API. Implements the same three-method interface as LocalDiskDriver — put/delete/
 * urlFor — so no caller knows or cares which driver is active. Flipping
 * STORAGE_DRIVER=s3 is a config change, not a rewrite of the upload pipeline.
 *
 * Config (env, read lazily so it can be set after construction — same pattern as
 * LocalDiskDriver's baseDir):
 *   R2_BUCKET             bucket name
 *   R2_ACCESS_KEY_ID      R2 access key
 *   R2_SECRET_ACCESS_KEY  R2 secret
 *   R2_ENDPOINT           S3 API endpoint (e.g. https://<acct>.r2.cloudflarestorage.com)
 *   R2_PUBLIC_BASE_URL    public read base (r2.dev or custom domain) — NOT the API
 *                         endpoint, which is auth-only and can't back an <img src>.
 *
 * Keys match LocalDiskDriver exactly (`<sanitized-hint>-<timestamp>.jpg`) so the
 * Item.image.ref shape is identical regardless of driver.
 */
export class S3Driver {
  constructor({ client, bucket, publicBaseUrl, endpoint, accessKeyId, secretAccessKey } = {}) {
    this._client = client; // explicit override (tests); else built lazily from env
    this._bucket = bucket;
    this._publicBaseUrl = publicBaseUrl;
    this._endpoint = endpoint;
    this._accessKeyId = accessKeyId;
    this._secretAccessKey = secretAccessKey;
  }

  get bucket() {
    const b = this._bucket || process.env.R2_BUCKET;
    if (!b) throw new Error("R2_BUCKET is not set");
    return b;
  }

  // Public read base for <img src>. Trailing slash normalized so urlFor joins cleanly.
  get publicBaseUrl() {
    const u = this._publicBaseUrl || process.env.R2_PUBLIC_BASE_URL;
    if (!u) throw new Error("R2_PUBLIC_BASE_URL is not set");
    return u.replace(/\/+$/, "");
  }

  // Lazily build the S3 client from env (region "auto" is required by R2).
  get client() {
    if (!this._client) {
      const endpoint = this._endpoint || process.env.R2_ENDPOINT;
      const accessKeyId = this._accessKeyId || process.env.R2_ACCESS_KEY_ID;
      const secretAccessKey = this._secretAccessKey || process.env.R2_SECRET_ACCESS_KEY;
      if (!endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error(
          "R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must all be set for STORAGE_DRIVER=s3"
        );
      }
      this._client = new S3Client({
        region: "auto",
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
      });
    }
    return this._client;
  }

  /** Upload bytes; returns the generated key. keyHint is typically the itemId. */
  async put(buffer, keyHint) {
    const safeHint = String(keyHint ?? "").replace(/[^A-Za-z0-9-]/g, "") || "item";
    const key = `${safeHint}-${Date.now()}.jpg`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: "image/jpeg", // bytes are always JPEG (resized by Sharp upstream)
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    return key;
  }

  /** Remove bytes. S3 DeleteObject is idempotent — a missing key is a no-op. */
  async delete(key) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Absolute public URL the frontend puts in <img src>. */
  urlFor(key) {
    return `${this.publicBaseUrl}/${key}`;
  }
}
