import { useState } from "react";
import { Modal, Badge, Button, ErrorText } from "../../components/ui";
import { formatPaisa, decimalText } from "../../lib/format";
import { usePurchase, useReversePurchase } from "./hooks";

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-PK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Read-only view of one posted purchase and its lines, with a reverse action. */
export default function PurchaseDetail({ purchaseId, onClose }) {
  const { data: p, isLoading, error } = usePurchase(purchaseId);
  const reverseMut = useReversePurchase();
  const [confirming, setConfirming] = useState(false);

  const reversed = p?.reversed;

  async function doReverse() {
    try {
      await reverseMut.mutateAsync(purchaseId);
      setConfirming(false);
    } catch {
      /* error shown inline below */
    }
  }

  const footer = !p ? (
    <Button onClick={onClose}>Close</Button>
  ) : confirming ? (
    <>
      <Button variant="secondary" type="button" onClick={() => setConfirming(false)} disabled={reverseMut.isPending}>
        Keep it
      </Button>
      <Button variant="danger" type="button" onClick={doReverse} disabled={reverseMut.isPending}>
        {reverseMut.isPending ? "Reversing…" : "Yes, reverse"}
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" type="button" onClick={onClose}>Close</Button>
      <Button variant="danger" type="button" onClick={() => setConfirming(true)} disabled={reversed}>
        {reversed ? "Reversed" : "Reverse"}
      </Button>
    </>
  );

  return (
    <Modal title="Purchase" onClose={onClose} footer={footer}>
      {isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {p && (
        <div className="space-y-4">
          {reversed && (
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-fg-muted">
              <Badge tone="gray">Reversed</Badge>
              <span>
                This purchase was reversed{p.reversedAt ? ` on ${formatDate(p.reversedAt)}` : ""} — its stock,
                payable, and average cost were undone.
              </span>
            </div>
          )}
          {confirming && !reversed && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Reverse this purchase? Stock will be taken back out, any supplier payable restored, and
              the item's average cost recomputed from history. This can't be undone (re-enter the
              purchase if needed).
            </div>
          )}
          {reverseMut.isError && <ErrorText>{reverseMut.error.message}</ErrorText>}

          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-fg-muted">Date</span>
            <span className="text-right text-fg">{formatDate(p.date)}</span>
            <span className="text-fg-muted">Supplier</span>
            <span className="text-right text-fg">{p.supplierId?.name ?? "—"}</span>
            <span className="text-fg-muted">Payment</span>
            <span className="text-right">
              {p.paymentType === "credit" ? (
                <Badge tone="amber">Credit</Badge>
              ) : (
                <Badge tone="green">Paid</Badge>
              )}
            </span>
            {p.note && (
              <>
                <span className="text-fg-muted">Note</span>
                <span className="text-right text-fg-muted">{p.note}</span>
              </>
            )}
          </div>

          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Unit cost</th>
                  <th className="px-3 py-2 text-right font-medium">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {p.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-fg">
                      {l.itemId?.name ?? "—"}
                      {l.itemId?.sku && (
                        <span className="ml-1 text-xs text-fg-subtle">{l.itemId.sku}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {decimalText(l.qty)}
                      {l.itemId?.baseUnit && (
                        <span className="ml-1 text-xs text-fg-subtle">{l.itemId.baseUnit}</span>
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
              <tfoot className="border-t border-line bg-muted">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right font-medium text-fg-muted">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg">
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
