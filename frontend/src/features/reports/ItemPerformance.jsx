import { useMemo, useState } from "react";
import { formatPaisa, decimalText } from "../../lib/format";

const SORTS = [
  { key: "qtySold", label: "Qty sold" },
  { key: "revenue", label: "Revenue" },
  { key: "grossProfit", label: "Gross profit" },
];

const num = (s) => Number(decimalText(s));

/** Item performance table (spec 006 §4.4), sortable, default profit desc, top 20
 *  + expand. Numbers already net returns server-side. Dead stock listed below. */
export default function ItemPerformance({ items, deadStock }) {
  const [sortKey, setSortKey] = useState("grossProfit");
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => [...items].sort((a, b) => num(b[sortKey]) - num(a[sortKey])), [items, sortKey]);
  const rows = showAll ? sorted : sorted.slice(0, 20);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Item performance</h2>
        <div className="flex gap-1">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSortKey(s.key)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                sortKey === s.key ? "bg-indigo-50 text-indigo-700" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500">No sales in this window.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-1.5">Item</th>
                <th className="py-1.5">SKU</th>
                <th className="py-1.5 text-right">Qty sold</th>
                <th className="py-1.5 text-right">Revenue</th>
                <th className="py-1.5 text-right">Gross profit</th>
                <th className="py-1.5 text-right">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.itemId}>
                  <td className="py-1.5 text-gray-900">{r.name}</td>
                  <td className="py-1.5 text-gray-500">{r.sku}</td>
                  <td className="py-1.5 text-right tabular-nums">{decimalText(r.qtySold)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatPaisa(r.revenue)}</td>
                  <td className={`py-1.5 text-right tabular-nums ${num(r.grossProfit) < 0 ? "text-red-600" : "text-gray-900"}`}>
                    {formatPaisa(r.grossProfit)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-gray-600">{decimalText(r.stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length > 20 && (
            <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-medium text-indigo-600 hover:underline">
              {showAll ? "Show top 20" : `Show all ${sorted.length}`}
            </button>
          )}
        </>
      )}

      <div className="mt-5">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Dead stock — in stock, no sales this window
        </h3>
        {deadStock.length === 0 ? (
          <p className="text-sm text-gray-400">None — everything in stock sold at least once.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {deadStock.map((d) => (
              <li key={d.itemId} className="flex justify-between py-1.5">
                <span className="text-gray-700">
                  {d.name} <span className="text-gray-400">{d.sku}</span>
                </span>
                <span className="tabular-nums text-gray-600">{decimalText(d.stock)} in stock</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
