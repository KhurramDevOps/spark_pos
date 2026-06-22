import { useState } from "react";
import { Modal, Badge, Button, ErrorText } from "../../components/ui";
import { formatPaisa, decimalText } from "../../lib/format";
import { useSale, useVoidSale } from "./hooks";
import SaleReturnForm from "./SaleReturnForm";

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "numeric" });
}
const rsFromPaisa = (paisa) => formatPaisa(paisa);

/** View of one posted sale: per-line price/cost/profit, with void + return actions. */
export default function SaleDetail({ saleId, onClose }) {
  const { data: s, isLoading, error } = useSale(saleId);
  const voidMut = useVoidSale();
  const [confirming, setConfirming] = useState(false);
  const [showReturn, setShowReturn] = useState(false);

  const voided = s?.voided;

  async function doVoid() {
    try {
      await voidMut.mutateAsync(saleId);
      setConfirming(false);
    } catch { /* shown inline */ }
  }

  const totalProfit =
    s?.lines.reduce(
      (sum, l) =>
        sum + (Number(decimalText(l.unitPrice)) - Number(decimalText(l.costAtTime))) * Number(decimalText(l.qty)),
      0
    ) ?? 0;

  const footer = !s ? (
    <Button onClick={onClose}>Close</Button>
  ) : confirming ? (
    <>
      <Button variant="secondary" type="button" onClick={() => setConfirming(false)} disabled={voidMut.isPending}>Keep it</Button>
      <Button variant="danger" type="button" onClick={doVoid} disabled={voidMut.isPending}>
        {voidMut.isPending ? "Voiding…" : "Yes, void"}
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" type="button" onClick={onClose}>Close</Button>
      <Button variant="secondary" type="button" onClick={() => setShowReturn(true)} disabled={voided}>Record return</Button>
      <Button variant="danger" type="button" onClick={() => setConfirming(true)} disabled={voided}>
        {voided ? "Voided" : "Void"}
      </Button>
    </>
  );

  return (
    <Modal title="Sale" onClose={onClose} footer={footer}>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {s && (
        <div className="space-y-4">
          {voided && (
            <div className="flex items-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-600">
              <Badge tone="gray">Voided</Badge>
              <span>This sale was voided{s.voidedAt ? ` on ${formatDate(s.voidedAt)}` : ""} — its stock and khata effect were undone.</span>
            </div>
          )}
          {confirming && !voided && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Void this sale? Stock goes back and any credit khata is reversed. This can't be undone (re-enter the sale if needed).
            </div>
          )}
          {voidMut.isError && <ErrorText>{voidMut.error.message}</ErrorText>}

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

      {showReturn && s && <SaleReturnForm sale={s} onClose={() => setShowReturn(false)} />}
    </Modal>
  );
}
