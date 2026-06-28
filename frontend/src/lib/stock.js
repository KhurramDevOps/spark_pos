import { formatBundleStock } from "@shared/inventory/bundle.js";
import { decimalText } from "./format";

/**
 * Human label for an item's stock on hand (spec 011). Bundle items render as
 * "3 bundles + 40 gaz"; everyone else as "<qty> <baseUnit>". The underlying gaz value
 * is never rounded — only the display split is.
 */
export function stockLabel(item) {
  const gaz = decimalText(item.stockQty);
  return item.bundle ? formatBundleStock(gaz) : `${gaz} ${item.baseUnit}`;
}
