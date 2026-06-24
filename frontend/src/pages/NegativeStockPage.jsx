import { useState } from "react";
import { Button } from "../components/ui";
import { formatPaisa, decimalText } from "../lib/format";
import { useNegativeStockItems } from "../features/inventory/hooks";
import AdjustStockModal from "../features/inventory/AdjustStockModal";

const catName = (c) => (typeof c === "object" && c ? c.name : "—");

/**
 * Owner view of items whose stock has gone negative (spec 001's deferred view,
 * built with sales in spec 004 — sales are what drive stock below 0). View-only,
 * with a quick "Adjust" to correct the count via the existing modal.
 */
export default function NegativeStockPage() {
  const { data: items = [], isLoading, isError, error } = useNegativeStockItems();
  const [adjustItem, setAdjustItem] = useState(null);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-fg">Negative stock</h1>
        <p className="text-sm text-fg-muted">
          Items showing below zero — usually a count that was off, or stock sold through. Adjust to
          correct the count.
        </p>
      </header>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-2 font-medium">SKU</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 text-right font-medium">Stock</th>
              <th className="px-4 py-2 text-right font-medium">Avg cost</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-fg-subtle">Loading…</td></tr>
            ) : isError ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-red-600">{error.message}</td></tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-fg-subtle">
                  No items are below zero — stock is clean. ✓
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item._id}>
                  <td className="px-4 py-2 font-mono text-xs text-fg-muted">{item.sku}</td>
                  <td className="px-4 py-2 font-medium text-fg">{item.name}</td>
                  <td className="px-4 py-2 text-fg-muted">{catName(item.categoryId)}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="font-semibold tabular-nums text-red-600">{decimalText(item.stockQty)}</span>{" "}
                    <span className="text-xs text-fg-subtle">{item.baseUnit}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-fg-muted">
                    {formatPaisa(decimalText(item.avgCost))}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" onClick={() => setAdjustItem(item)}>Adjust</Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && !isError && (
        <p className="mt-3 text-sm text-fg-muted">
          {items.length} item{items.length === 1 ? "" : "s"} below zero.
        </p>
      )}

      {adjustItem && <AdjustStockModal item={adjustItem} onClose={() => setAdjustItem(null)} />}
    </div>
  );
}
