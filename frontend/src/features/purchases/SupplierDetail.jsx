import { useState } from "react";
import { Modal, Badge, Button } from "../../components/ui";
import { formatPaisa, decimalText } from "../../lib/format";
import { formatBalance } from "../../lib/balance";
import { useSupplier, useSupplierPayments, useSupplierReturns, usePurchases } from "./hooks";
import PaymentForm from "./PaymentForm";
import SupplierForm from "./SupplierForm";
import SupplierReturnForm from "./SupplierReturnForm";

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-PK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Build a chronological ledger from credit/cash purchases + payments + returns,
 * carrying a running balance from openingBalance. Credit purchases (+), payments
 * (−) and returns (−) move the balance; cash purchases appear for context but
 * don't. Paisa are whole integers here, so Number arithmetic is safe for this
 * display (server is authoritative for the cached balance).
 */
function buildLedger(openingBalance, purchases, payments, returns) {
  const events = [
    ...purchases.map((p) => ({
      kind: "purchase",
      id: p._id,
      date: p.date,
      createdAt: p.createdAt,
      credit: p.paymentType === "credit",
      amount: Number(decimalText(p.total)),
    })),
    ...payments.map((pm) => ({
      kind: "payment",
      id: pm._id,
      date: pm.date,
      createdAt: pm.createdAt,
      amount: Number(decimalText(pm.amount)),
      note: pm.note,
    })),
    ...returns.map((r) => ({
      kind: "return",
      id: r._id,
      date: r.date,
      createdAt: r.createdAt,
      amount: Number(decimalText(r.total)),
      note: r.note,
      qty: r.lines.reduce((s, l) => s + Number(decimalText(l.qty)), 0),
    })),
  ];

  // Oldest first to accumulate the running balance, then reverse for display.
  // Order by posting time (createdAt) — the user-facing `date` can be date-only
  // (midnight) and would otherwise sort a same-day payment before its purchase.
  events.sort((a, b) => {
    const d = new Date(a.createdAt) - new Date(b.createdAt);
    if (d !== 0) return d;
    return new Date(a.date) - new Date(b.date);
  });

  let running = Number(openingBalance);
  const rows = events.map((e) => {
    let delta = 0;
    if (e.kind === "payment" || e.kind === "return") delta = -e.amount;
    else if (e.credit) delta = e.amount;
    running += delta;
    return { ...e, delta, running };
  });

  return rows.reverse(); // newest first
}

export default function SupplierDetail({ supplierId, onClose }) {
  const [showPayment, setShowPayment] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showReturn, setShowReturn] = useState(false);

  const { data: supplier, isLoading: loadingSupplier, error } = useSupplier(supplierId);
  const { data: payments = [] } = useSupplierPayments(supplierId);
  const { data: returns = [] } = useSupplierReturns(supplierId);
  const { data: purchasesData } = usePurchases({ supplierId, limit: 100 });
  const purchases = purchasesData?.purchases ?? [];

  const opening = supplier ? decimalText(supplier.openingBalance) : "0";
  const rows = supplier ? buildLedger(opening, purchases, payments, returns) : [];
  const bal = supplier ? formatBalance(decimalText(supplier.balance)) : null;
  const openingNum = Number(opening);

  return (
    <Modal
      title={supplier ? supplier.name : "Supplier"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => setShowEdit(true)} disabled={!supplier}>
            Edit
          </Button>
          <Button variant="secondary" onClick={() => setShowReturn(true)} disabled={!supplier}>
            Record return
          </Button>
          <Button onClick={() => setShowPayment(true)} disabled={!supplier}>
            Record payment
          </Button>
        </>
      }
    >
      {loadingSupplier && <p className="text-sm text-fg-muted">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {supplier && (
        <div className="space-y-4">
          {/* Header: balance + meta */}
          <div className="flex items-start justify-between rounded-md bg-muted p-3">
            <div className="text-sm text-fg-muted">
              {supplier.phone ? <div>{supplier.phone}</div> : <div className="text-fg-subtle">No phone</div>}
              {!supplier.isActive && <Badge tone="gray">Inactive</Badge>}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-fg-subtle">Balance</div>
              <div className={`text-lg font-semibold ${bal.className}`}>{bal.text}</div>
            </div>
          </div>

          {/* Activity ledger */}
          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Activity</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-fg-subtle">
                      No purchases or payments yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={`${r.kind}-${r.id}`}>
                      <td className="px-3 py-2 text-fg-muted">{formatDate(r.date)}</td>
                      <td className="px-3 py-2">
                        {r.kind === "payment" ? (
                          <span className="text-fg">
                            Payment{r.note ? <span className="ml-1 text-xs text-fg-subtle">{r.note}</span> : null}
                          </span>
                        ) : r.kind === "return" ? (
                          <span className="text-fg">
                            Return <Badge tone="green">stock back</Badge>
                            {r.note ? <span className="ml-1 text-xs text-fg-subtle">{r.note}</span> : null}
                          </span>
                        ) : r.credit ? (
                          <span className="text-fg">
                            Purchase <Badge tone="amber">credit</Badge>
                          </span>
                        ) : (
                          <span className="text-fg-muted">
                            Purchase <Badge tone="green">paid</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.delta === 0 ? (
                          <span className="text-fg-subtle">—</span>
                        ) : r.delta > 0 ? (
                          <span className="text-amber-700">+{formatPaisa(r.delta)}</span>
                        ) : (
                          <span className="text-green-700">−{formatPaisa(-r.delta)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-fg">
                        {formatPaisa(r.running)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="border-t border-line bg-muted text-xs text-fg-muted">
                <tr>
                  <td colSpan={4} className="px-3 py-2">
                    Opening balance: {formatPaisa(openingNum)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {showPayment && supplier && (
        <PaymentForm supplier={supplier} onClose={() => setShowPayment(false)} />
      )}
      {showEdit && supplier && (
        <SupplierForm supplier={supplier} onClose={() => setShowEdit(false)} />
      )}
      {showReturn && supplier && (
        <SupplierReturnForm supplier={supplier} onClose={() => setShowReturn(false)} />
      )}
    </Modal>
  );
}
