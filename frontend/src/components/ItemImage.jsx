import { useState } from "react";

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
      className={`shrink-0 rounded bg-gray-50 object-cover ${className}`}
    />
  );

  if (!hover) return thumb;

  return (
    <span className="group relative inline-block">
      {thumb}
      <span
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white p-1 opacity-0 shadow-lg transition-opacity duration-[250ms] group-hover:opacity-100"
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
      </span>
    </span>
  );
}
