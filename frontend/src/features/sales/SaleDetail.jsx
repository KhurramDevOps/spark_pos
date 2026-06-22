import { Modal, Badge, Button } from "../../components/ui";
import { formatPaisa, decimalText } from "../../lib/format";
import { useSale } from "./hooks";

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "numeric" });
}
const rsFromPaisa = (paisa) => formatPaisa(paisa);

/** Read-only view of one posted sale: per-line price, cost, and profit. */
export default function SaleDetail({ saleId, onClose }) {
  const { data: s, isLoading, error } = useSale(saleId);

  const totalProfit =
    s?.lines.reduce(
      (sum, l) =>
        sum + (Number(decimalText(l.unitPrice)) - Number(decimalText(l.costAtTime))) * Number(decimalText(l.qty)),
      0
    ) ?? 0;

  return (
    <Modal title="Sale" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {s && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-gray-500">Date</span>
            <span className="text-right text-gray-900">{formatDate(s.date)}</span>
            <span className="text-gray-500">Customer</span>
            <span className="text-right text-gray-900">{s.customerId?.name ?? "—"}</span>
            <span className="text-gray-500">Payment</span>
            <span className="text-right">
              {s.paymentType === "credit" ? <Badge tone="amber">Credit</Badge> : <Badge tone="green">Cash</Badge>}
            </span>
            <span className="text-gray-500">Price mode</span>
            <span className="text-right text-gray-700 capitalize">{s.priceMode}</span>
            {s.note && (
              <>
                <span className="text-gray-500">Note</span>
                <span className="text-right text-gray-700">{s.note}</span>
              </>
            )}
          </div>

          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {s.lines.map((l, i) => {
                  const price = Number(decimalText(l.unitPrice));
                  const cost = Number(decimalText(l.costAtTime));
                  const qty = Number(decimalText(l.qty));
                  const profit = ((price - cost) * qty) / 100;
                  const belowCost = price < cost;
                  return (
                    <tr key={i}>
                      <td className="px-3 py-2 text-gray-900">
                        {l.itemId?.name ?? "—"}
                        {l.itemId?.sku && <span className="ml-1 text-xs text-gray-400">{l.itemId.sku}</span>}
                        {belowCost && <span className="ml-2"><Badge tone="red">below cost</Badge></span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {decimalText(l.qty)}
                        {l.itemId?.baseUnit && <span className="ml-1 text-xs text-gray-400">{l.itemId.baseUnit}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{rsFromPaisa(price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{rsFromPaisa(cost)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${profit < 0 ? "text-red-600" : "text-green-700"}`}>
                        {formatPaisa(Math.round((price - cost) * qty))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-gray-200 bg-gray-50">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right font-medium text-gray-700">Total</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                    {formatPaisa(decimalText(s.total))}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${totalProfit < 0 ? "text-red-600" : "text-green-700"}`}>
                    {formatPaisa(Math.round(totalProfit))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
