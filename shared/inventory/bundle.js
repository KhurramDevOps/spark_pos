// Wire bundles (spec 011 / ADR-019). A wire item is bought by the BUNDLE but sold by
// the GAZ; every bundle is exactly 90 gaz — a fixed, universal constant of the trade,
// NOT a per-item setting. The canonical stored unit is always the gaz; "bundle" is a
// data-entry + display convention layered on top (÷90 / ×90). The precision-critical
// bundle→gaz cost conversion happens server-side with the Decimal lib at purchase time;
// the helpers here are DISPLAY-only and may use Number safely (no money is divided).

export const BUNDLE_GAZ = 90;

// Round to 4 dp to strip float noise from a remainder (e.g. 457.3 − 450 = 7.2999…995).
// Display granularity only — the canonical gaz value is always the exact stored string.
function clean(n) {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Split a total-gaz amount into whole bundles + loose gaz, for display. Operates on the
 * magnitude (negative stock is shown as raw gaz by formatBundleStock, not split).
 * @param {string|number} totalGaz
 * @returns {{ bundles: number, loose: number }}
 */
export function splitGaz(totalGaz) {
  const g = Number(totalGaz);
  if (!Number.isFinite(g)) return { bundles: 0, loose: 0 };
  const abs = Math.abs(g);
  const bundles = Math.floor(clean(abs) / BUNDLE_GAZ);
  const loose = clean(abs - bundles * BUNDLE_GAZ);
  const sign = g < 0 ? -1 : 1;
  return { bundles: sign * bundles, loose: sign * loose };
}

/**
 * Human display of bundle-item stock: "3 bundles + 40 gaz" / "5 bundles" / "40 gaz".
 * Negative stock is shown honestly as raw gaz (e.g. "-5 gaz") — you can't have a
 * negative number of sealed bundles.
 */
export function formatBundleStock(totalGaz) {
  const g = Number(totalGaz);
  if (!Number.isFinite(g)) return `${totalGaz} gaz`;
  if (g < 0) return `${clean(g)} gaz`;
  const { bundles, loose } = splitGaz(g);
  const parts = [];
  if (bundles > 0) parts.push(`${bundles} bundle${bundles === 1 ? "" : "s"}`);
  if (loose > 0 || bundles === 0) parts.push(`${clean(loose)} gaz`);
  return parts.join(" + ");
}

/** Per-bundle price (display hint) from a per-gaz price: integer paisa × 90, exact. */
export function perBundleFromPerGaz(perGazPaisa) {
  return Number(perGazPaisa) * BUNDLE_GAZ;
}
