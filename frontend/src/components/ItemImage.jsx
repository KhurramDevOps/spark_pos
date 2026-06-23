import { useState, useCallback } from "react";

// Build the <img src> for an item image (spec 006b). Uploads are served from the
// local static route with a ?v=updatedAt cache-bust (so replacing an image shows
// immediately); URL-kind images render their external ref directly.
function imageSrc(image) {
  if (!image || !image.ref) return null;
  if (image.kind === "url") return image.ref;
  const v = image.updatedAt ? `?v=${new Date(image.updatedAt).getTime()}` : "";
  return `/api/static/items/${image.ref}${v}`;
}

function Placeholder({ size, className }) {
  return (
    <div
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded bg-gray-100 text-gray-300 ${className}`}
      aria-hidden="true"
    >
      <svg width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    </div>
  );
}

/**
 * One reusable product thumbnail (spec 006b) used across Inventory, POS picker,
 * and Reports. Renders the image (upload or URL), a tasteful gray placeholder
 * when absent, and — when `hover` — a larger floating preview on mouseover.
 * Thumbnails lazy-load. A broken/rotted URL falls back to the placeholder.
 *
 * @param {{ kind:'upload'|'url', ref:string, updatedAt?:string }|null} image
 * @param {number} size       thumbnail edge in px (default 48)
 * @param {boolean} hover      show the enlarge-on-hover preview (default false)
 * @param {number} previewSize hover-preview edge in px (default 280)
 */
export default function ItemImage({ image, size = 48, hover = false, previewSize = 280, alt = "", className = "" }) {
  const src = imageSrc(image);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState(null); // { top, left } | null

  // Position a viewport-fixed preview next to the thumbnail. Fixed positioning
  // escapes the table's stacking/overflow entirely (a pure-CSS absolute preview
  // inside a <td> won't reliably paint above sibling rows). Flips to the left
  // when there isn't room on the right; clamps vertically to the viewport.
  const showPreview = useCallback(
    (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const gap = 8;
      let left = r.right + gap;
      if (left + previewSize + gap > window.innerWidth) left = r.left - previewSize - gap;
      const top = Math.min(
        Math.max(gap, r.top + r.height / 2 - previewSize / 2),
        window.innerHeight - previewSize - gap
      );
      setPreview({ top, left });
    },
    [previewSize]
  );
  const hidePreview = useCallback(() => setPreview(null), []);

  if (!src || failed) return <Placeholder size={size} className={className} />;

  const thumb = (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      onMouseEnter={hover ? showPreview : undefined}
      onMouseLeave={hover ? hidePreview : undefined}
      className={`shrink-0 rounded bg-gray-50 object-cover ${className}`}
    />
  );

  if (!hover) return thumb;

  return (
    <>
      {thumb}
      {preview && (
        <div
          className="item-image-preview pointer-events-none fixed rounded-lg border border-gray-200 bg-white p-1 shadow-xl"
          style={{ top: preview.top, left: preview.left, zIndex: 1000 }}
          aria-hidden="true"
        >
          <img
            src={src}
            alt=""
            width={previewSize}
            height={previewSize}
            style={{ width: previewSize, height: previewSize }}
            className="rounded object-contain"
          />
        </div>
      )}
    </>
  );
}
