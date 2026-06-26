/**
 * One-line label of the items in a sale, for the Sales History list's "Items"
 * column: the first line's name, plus "+N more" when the sale has more lines.
 * Item lines (spec 004) expect `itemId` populated to `{ name }` (listSales does
 * this). Quick lines (spec 008) carry their own free-text `name` and no itemId.
 * Items are deactivated, never hard-deleted, so the populate normally resolves; a
 * missing one falls back to "Unknown item" rather than throwing.
 *
 * @param {{ lines?: Array<{ itemId?: { name?: string } | null, name?: string }> }} sale
 * @returns {string}
 */
export function saleItemsLabel(sale) {
  const lines = Array.isArray(sale?.lines) ? sale.lines : [];
  if (lines.length === 0) return "—";
  const first = lines[0]?.itemId?.name ?? lines[0]?.name ?? "Unknown item";
  if (lines.length === 1) return first;
  return `${first} +${lines.length - 1} more`;
}
