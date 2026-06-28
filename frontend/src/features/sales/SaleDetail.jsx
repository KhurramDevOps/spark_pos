import { useState } from "react";
import { Modal, Badge, Button, ErrorText } from "../../components/ui";
import { formatPaisa, decimalText, paisaToRupeesInput } from "../../lib/format";
import { warrantyStatus, formatYmd, karachiYMD } from "@shared/warranty/expiry.js";
import { useAuth } from "../auth/useAuth";
import { useCategories } from "../inventory/hooks";
import ItemForm from "../inventory/ItemForm";
import { useSale, useVoidSale, useSaleReturns } from "./hooks";
import SaleReturnForm from "./SaleReturnForm";

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "numeric" });
}
// Today's Asia/Karachi date as YYYY-MM-DD (the default claim date for warranty checks).
function todayKarachi() {
  const { year, month, day } = karachiYMD(new Date());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const rsFromPaisa = (paisa) => formatPaisa(paisa);

/** View of one posted sale: per-line price/cost/profit, with void + return actions. */
export default function SaleDetail({ saleId, onClose }) {
  const { isOwner } = useAuth();
  const { data: categories = [] } = useCategories();
  const { data: s, isLoading, error } = useSale(saleId);
  const { data: returns = [] } = useSaleReturns(saleId);
  const voidMut = useVoidSale();
  const [confirming, setConfirming] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  // Warranty claim check (spec 009): the date to test each term against (default today).
  const [claimDate, setClaimDate] = useState(todayKarachi);
  // Quick line being catalogued (slice 6): seeds the item create form. null = closed.
  const [promoteLine, setPromoteLine] = useState(null);

  const voided = s?.voided;
  const hasReturns = returns.length > 0;

  async function doVoid() {
    try {
      await voidMut.mutateAsync(saleId);
      setConfirming(false);
    } catch { /* shown inline */ }
  }

  // Quick lines have NO cost basis (ADR-016) — their profit is unknown and must never
  // be formed from a defaulted cost of 0. Skip them in the sale's total profit.
  const totalProfit =
    s?.lines.reduce(
      (sum, l) =>
        l.kind === "quick"
          ? sum
          : sum + (Number(decimalText(l.unitPrice)) - Number(decimalText(l.costAtTime))) * Number(decimalText(l.qty)),
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
      <Button
        variant="danger"
        type="button"
        onClick={() => setConfirming(true)}
        disabled={voided || hasReturns}
        title={hasReturns && !voided ? "Reverse the returns first to void this sale" : undefined}
      >
        {voided ? "Voided" : "Void"}
      </Button>
    </>
  );

  return (
    <Modal title="Sale" onClose={onClose} footer={footer}>
      {isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>}
      {s && (
        <div className="space-y-4">
          {voided && (
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-fg-muted">
              <Badge tone="gray">Voided</Badge>
              <span>This sale was voided{s.voidedAt ? ` on ${formatDate(s.voidedAt)}` : ""} — its stock and khata effect were undone.</span>
            </div>
          )}
          {confirming && !voided && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/60 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              Void this sale? Stock goes back and any credit khata is reversed. This can't be undone (re-enter the sale if needed).
            </div>
          )}
          {hasReturns && !voided && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/50 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              This sale has returns against it — it can't be voided. Reverse the returns first if you really need to void it.
            </div>
          )}
          {voidMut.isError && <ErrorText>{voidMut.error.message}</ErrorText>}

          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-fg-muted">Date</span>
            <span className="text-right text-fg">{formatDate(s.date)}</span>
            <span className="text-fg-muted">Customer</span>
            <span className="text-right text-fg">{s.customerId?.name ?? "—"}</span>
            <span className="text-fg-muted">Payment</span>
            <span className="text-right">
              {s.paymentType === "credit" ? <Badge tone="amber">Credit</Badge> : <Badge tone="green">Cash</Badge>}
            </span>
            <span className="text-fg-muted">Price mode</span>
            <span className="text-right text-fg-muted capitalize">{s.priceMode}</span>
            {s.note && (
              <>
                <span className="text-fg-muted">Note</span>
                <span className="text-right text-fg-muted">{s.note}</span>
              </>
            )}
          </div>

          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.lines.map((l, i) => {
                  const price = Number(decimalText(l.unitPrice));
                  const qty = Number(decimalText(l.qty));

                  // Quick line (ADR-016): no cost basis → no cost/profit shown (an unknown
                  // cost must never read as 0). Owner can catalogue it for FUTURE sales.
                  if (l.kind === "quick") {
                    return (
                      <tr key={i}>
                        <td className="px-3 py-2 text-fg">
                          {l.name}
                          <span className="ml-2"><Badge tone="gray">quick</Badge></span>
                          {isOwner && (
                            <button
                              type="button"
                              className="ml-2 text-xs font-medium text-accent hover:text-accent"
                              onClick={() => setPromoteLine(l)}
                              title="Create a catalogued item from this — for future sales only"
                            >
                              Catalogue this item
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{decimalText(l.qty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{rsFromPaisa(price)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-subtle">—</td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-subtle">—</td>
                      </tr>
                    );
                  }

                  const cost = Number(decimalText(l.costAtTime));
                  const profit = ((price - cost) * qty) / 100;
                  const belowCost = price < cost;
                  return (
                    <tr key={i}>
                      <td className="px-3 py-2 text-fg">
                        {l.itemId?.name ?? "—"}
                        {l.itemId?.sku && <span className="ml-1 text-xs text-fg-subtle">{l.itemId.sku}</span>}
                        {belowCost && <span className="ml-2"><Badge tone="red">below cost</Badge></span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {decimalText(l.qty)}
                        {l.itemId?.baseUnit && <span className="ml-1 text-xs text-fg-subtle">{l.itemId.baseUnit}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.itemId?.bundle ? (
                          <span className="font-semibold text-indigo-600 dark:text-indigo-300">{rsFromPaisa(price)} <span className="text-xs font-normal">/gaz</span></span>
                        ) : (
                          rsFromPaisa(price)
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{rsFromPaisa(cost)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${profit < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
                        {formatPaisa(Math.round((price - cost) * qty))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-line bg-muted">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right font-medium text-fg-muted">Total</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg">
                    {formatPaisa(decimalText(s.total))}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${totalProfit < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
                    {formatPaisa(Math.round(totalProfit))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {s.lines.some((l) => l.warranties?.length) && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">Warranty</div>
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  Check as of
                  <input
                    type="date"
                    className="rounded border border-line px-2 py-1 text-xs dark:bg-muted"
                    value={claimDate}
                    onChange={(e) => setClaimDate(e.target.value)}
                  />
                </label>
              </div>
              <div className="space-y-2">
                {s.lines
                  .filter((l) => l.warranties?.length)
                  .map((l, i) => (
                    <div key={i} className="rounded-md border border-line p-2">
                      <div className="mb-1 text-sm font-medium text-fg">{l.itemId?.name ?? "—"}</div>
                      <div className="space-y-1">
                        {l.warranties.map((w, j) => {
                          // claimDate is a YYYY-MM-DD string; the warranty clock runs from s.date.
                          const { valid, expiry } = warrantyStatus(s.date, w, new Date(claimDate));
                          return (
                            <div key={j} className="flex items-center justify-between gap-2 text-sm">
                              <span className="text-fg-muted">
                                {w.label || "Warranty"} — {w.durationValue} {w.durationUnit}
                              </span>
                              {valid ? (
                                <Badge tone="green">Valid until {formatYmd(expiry)}</Badge>
                              ) : (
                                <Badge tone="gray">Expired on {formatYmd(expiry)}</Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {hasReturns && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
                Returns against this sale
              </div>
              <div className="overflow-hidden rounded-md border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Items returned</th>
                      <th className="px-3 py-2 font-medium">Refund</th>
                      <th className="px-3 py-2 text-right font-medium">Refunded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {returns.map((r) => (
                      <tr key={r._id}>
                        <td className="px-3 py-2 text-fg-muted">{formatDate(r.date)}</td>
                        <td className="px-3 py-2 text-fg">
                          {r.lines.map((l) => `${l.itemId?.name ?? "—"} ×${decimalText(l.qty)}`).join(", ")}
                        </td>
                        <td className="px-3 py-2">
                          {r.refundMethod === "khata-credit"
                            ? <Badge tone="amber">khata credit</Badge>
                            : <Badge tone="green">cash</Badge>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg">
                          {formatPaisa(decimalText(r.total))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {showReturn && s && <SaleReturnForm sale={s} onClose={() => setShowReturn(false)} />}

      {/* Promote a quick line to a catalogued item (slice 6) — forward-only: this just
          creates a new Item for future sales, prefilled from the quick line. It does NOT
          touch this immutable sale (ADR-007); the quick line stays cost-less. */}
      {promoteLine && (
        <ItemForm
          categories={categories}
          prefill={{ name: promoteLine.name, retailPrice: paisaToRupeesInput(Number(decimalText(promoteLine.unitPrice))) }}
          onClose={() => setPromoteLine(null)}
        />
      )}
    </Modal>
  );
}
