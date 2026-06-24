import { useState, useRef, useEffect } from "react";
import { Button, TextInput, ErrorText } from "../../components/ui";
import ItemImage from "../../components/ItemImage";
import { useUploadItemImage, useDeleteItemImage, useUpdateItem } from "./hooks";

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

/**
 * Image controls for the Edit Item modal (spec 006b). Upload (drag-drop or
 * file-picker), paste a URL, or remove — each applied immediately against the
 * live item via its own mutation, so it never disturbs the other form fields.
 * Edit-mode only (uploads need an existing item id; create-mode uses a URL field).
 */
export default function ImageEditor({ item }) {
  const [image, setImage] = useState(item.image ?? null);
  const [url, setUrl] = useState(item.image?.kind === "url" ? item.image.ref : "");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(""); // transient "✓ …" confirmation
  const noticeTimer = useRef(null);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  function flash(msg) {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 2000);
  }

  const uploadMut = useUploadItemImage();
  const deleteMut = useDeleteItemImage();
  const urlMut = useUpdateItem();
  const busy = uploadMut.isPending || deleteMut.isPending || urlMut.isPending;

  async function doUpload(file) {
    setError("");
    if (!file) return;
    if (!ACCEPT.includes(file.type)) return setError("Use a JPEG, PNG, or WebP image.");
    if (file.size > 10 * 1024 * 1024) return setError("Image is over 10 MB.");
    try {
      const updated = await uploadMut.mutateAsync({ id: item._id, file });
      setImage(updated.image);
      setUrl("");
      flash("✓ Image uploaded");
    } catch (e) {
      setError(e.message);
    }
  }

  async function applyUrl() {
    setError("");
    const v = url.trim();
    let parsed;
    try {
      parsed = new URL(v);
    } catch {
      return setError("Enter a valid http(s) URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return setError("Only http(s) URLs are allowed.");
    }
    try {
      const updated = await urlMut.mutateAsync({ id: item._id, body: { image: { kind: "url", ref: v } } });
      setImage(updated.image);
      flash("✓ Image set from URL");
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove() {
    setError("");
    try {
      const updated = await deleteMut.mutateAsync(item._id);
      setImage(updated.image ?? null);
      setUrl("");
      flash("✓ Image removed");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <ItemImage image={image} size={72} alt={item.name} />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            doUpload(e.dataTransfer.files?.[0]);
          }}
          className={`flex-1 rounded border-2 border-dashed p-3 text-center text-xs transition ${
            dragOver ? "border-indigo-400 bg-indigo-50" : "border-line"
          }`}
        >
          Drag an image here, or{" "}
          <label className="cursor-pointer font-medium text-accent hover:underline">
            browse
            <input
              type="file"
              accept={ACCEPT.join(",")}
              className="hidden"
              onChange={(e) => doUpload(e.target.files?.[0])}
            />
          </label>
          <p className="mt-0.5 text-fg-subtle">JPEG / PNG / WebP, up to 10 MB. Resized automatically.</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or paste an image URL (https://…)" />
        <Button type="button" variant="secondary" onClick={applyUrl} disabled={busy || !url.trim()}>
          Use URL
        </Button>
      </div>

      <div className="flex items-center gap-3">
        {image && (
          <button type="button" onClick={remove} disabled={busy} className="text-xs text-red-600 hover:underline disabled:opacity-50">
            Remove image
          </button>
        )}
        {busy && <span className="text-xs text-fg-subtle">Working…</span>}
        {notice && <span className="text-xs font-medium text-green-600">{notice}</span>}
        {url && !notice && <span className="text-xs text-fg-subtle">URLs can rot — a dead link falls back to the placeholder.</span>}
      </div>

      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
