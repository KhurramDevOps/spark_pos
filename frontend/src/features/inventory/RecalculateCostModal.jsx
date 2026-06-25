import { useState } from "react";
import { Modal, Button, Badge, ErrorText } from "../../components/ui";
import { formatPaisa, decimalText } from "../../lib/format";
import { useRecalculateCost } from "./hooks";

// Drift report row (hoisted to module scope so it isn't recreated each render).
const Row = ({ label, before, after, changed }) => (
  <tr>
    <td className="px-3 py-2 text-fg-muted">{label}</td>
    <td className={`px-3 py-2 text-right tabular-nums ${changed ? "text-red-600 dark:text-red-400 line-through" : "text-fg-muted"}`}>
      {before}
    </td>
    <td className={`px-3 py-2 text-right tabular-nums font-medium ${changed ? "text-green-700 dark:text-green-400" : "text-fg-muted"}`}>
      {after}
    </td>
  </tr>
);

/**
 * Owner-only integrity repair: replay an item's avgCost + stockQty from its
 * movement history and show a drift report (cached vs recomputed). The backend
 * writes the corrected values; this surfaces what it found and fixed.
 */
export default function RecalculateCostModal({ item, onClose }) {
  const mut = useRecalculateCost();
  const [report, setReport] = useState(null);
  const [serverError, setServerError] = useState("");

  async function run() {
    setServerError("");
    try {
      setReport(await mut.mutateAsync(item._id));
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <Modal
      title="Recalculate cost"
      onClose={onClose}
      footer={
        report ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="button" onClick={run} disabled={mut.isPending}>
              {mut.isPending ? "Recalculating…" : "Recalculate from history"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <div>
          <div className="text-sm font-medium text-fg">{item.name}</div>
          <div className="font-mono text-xs text-fg-muted">{item.sku}</div>
        </div>

        {serverError && <ErrorText>{serverError}</ErrorText>}

        {!report ? (
          <p className="text-sm text-fg-muted">
            Re-derive this item's average cost and stock by replaying its full movement history
            (purchases, adjustments, returns, reversals). If the cached values have drifted, they'll
            be corrected. Owner-only.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {report.changed ? (
                <Badge tone="amber">Drift found &amp; corrected</Badge>
              ) : (
                <Badge tone="green">No drift — already correct</Badge>
              )}
            </div>
            <div className="overflow-hidden rounded-md border border-line">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium"></th>
                    <th className="px-3 py-2 text-right font-medium">Was (cached)</th>
                    <th className="px-3 py-2 text-right font-medium">Now (replayed)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <Row
                    label="Avg cost"
                    before={formatPaisa(report.before.avgCost)}
                    after={formatPaisa(report.after.avgCost)}
                    changed={report.before.avgCost !== report.after.avgCost}
                  />
                  <Row
                    label="Stock"
                    before={`${decimalText(report.before.stockQty)} ${item.baseUnit}`}
                    after={`${decimalText(report.after.stockQty)} ${item.baseUnit}`}
                    changed={report.before.stockQty !== report.after.stockQty}
                  />
                </tbody>
              </table>
            </div>
            {!report.changed && (
              <p className="text-sm text-fg-muted">
                The cached values already match the movement history — nothing to fix.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
