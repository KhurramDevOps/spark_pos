import { Modal, Badge, Button } from "../../components/ui";
import { formatPaisa, decimalText } from "../../lib/format";
import { usePurchase } from "./hooks";

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-PK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Read-only view of one posted purchase and its lines. */
export default function PurchaseDetail({ purchaseId, onClose }) {
  const { data: p, isLoading, error } = usePurchase(purchaseId);

  return (
    <Modal
      title="Purchase"
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {p && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-gray-500">Date</span>
            <span className="text-right text-gray-900">{formatDate(p.date)}</span>
            <span className="text-gray-500">Supplier</span>
            <span className="text-right text-gray-900">{p.supplierId?.name ?? "—"}</span>
            <span className="text-gray-500">Payment</span>
            <span className="text-right">
              {p.paymentType === "credit" ? (
                <Badge tone="amber">Credit</Badge>
              ) : (
                <Badge tone="green">Paid</Badge>
              )}
            </span>
            {p.note && (
              <>
                <span className="text-gray-500">Note</span>
                <span className="text-right text-gray-700">{p.note}</span>
              </>
            )}
          </div>

          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Unit cost</th>
                  <th className="px-3 py-2 text-right font-medium">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {p.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-gray-900">
                      {l.itemId?.name ?? "—"}
                      {l.itemId?.sku && (
                        <span className="ml-1 text-xs text-gray-400">{l.itemId.sku}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {decimalText(l.qty)}
                      {l.itemId?.baseUnit && (
                        <span className="ml-1 text-xs text-gray-400">{l.itemId.baseUnit}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPaisa(decimalText(l.unitCost))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPaisa(decimalText(l.lineTotal))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-gray-200 bg-gray-50">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right font-medium text-gray-700">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                    {formatPaisa(decimalText(p.total))}
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
