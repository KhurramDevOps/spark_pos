import { useState } from "react";
import { Modal, Badge, Button } from "../../components/ui";
import { formatPaisa, decimalText } from "../../lib/format";
import { formatBalance } from "../../lib/balance";
import { useSupplier, useSupplierPayments, usePurchases } from "./hooks";
import PaymentForm from "./PaymentForm";
import SupplierForm from "./SupplierForm";

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-PK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Build a chronological ledger from credit/cash purchases + payments, carrying a
 * running balance from openingBalance. Only credit purchases (+) and payments (−)
 * move the balance; cash purchases appear for context but don't. Paisa are whole
 * integers here, so Number arithmetic is safe for this display (server is
 * authoritative for the cached balance).
 */
function buildLedger(openingBalance, purchases, payments) {
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
  ];

  // Oldest first to accumulate the running balance, then reverse for display.
  events.sort((a, b) => {
    const d = new Date(a.date) - new Date(b.date);
    if (d !== 0) return d;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  let running = Number(openingBalance);
  const rows = events.map((e) => {
    let delta = 0;
    if (e.kind === "payment") delta = -e.amount;
    else if (e.credit) delta = e.amount;
    running += delta;
    return { ...e, delta, running };
  });

  return rows.reverse(); // newest first
}

export default function SupplierDetail({ supplierId, onClose }) {
  const [showPayment, setShowPayment] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const { data: supplier, isLoading: loadingSupplier, error } = useSupplier(supplierId);
  const { data: payments = [] } = useSupplierPayments(supplierId);
  const { data: purchasesData } = usePurchases({ supplierId, limit: 100 });
  const purchases = purchasesData?.purchases ?? [];

  const opening = supplier ? decimalText(supplier.openingBalance) : "0";
  const rows = supplier ? buildLedger(opening, purchases, payments) : [];
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
          <Button onClick={() => setShowPayment(true)} disabled={!supplier}>
            Record payment
          </Button>
        </>
      }
    >
      {loadingSupplier && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {supplier && (
        <div className="space-y-4">
          {/* Header: balance + meta */}
          <div className="flex items-start justify-between rounded-md bg-gray-50 p-3">
            <div className="text-sm text-gray-600">
              {supplier.phone ? <div>{supplier.phone}</div> : <div className="text-gray-400">No phone</div>}
              {!supplier.isActive && <Badge tone="gray">Inactive</Badge>}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-gray-400">Balance</div>
              <div className={`text-lg font-semibold ${bal.className}`}>{bal.text}</div>
            </div>
          </div>

          {/* Activity ledger */}
          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Activity</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">
                      No purchases or payments yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={`${r.kind}-${r.id}`}>
                      <td className="px-3 py-2 text-gray-700">{formatDate(r.date)}</td>
                      <td className="px-3 py-2">
                        {r.kind === "payment" ? (
                          <span className="text-gray-900">
                            Payment{r.note ? <span className="ml-1 text-xs text-gray-400">{r.note}</span> : null}
                          </span>
                        ) : r.credit ? (
                          <span className="text-gray-900">
                            Purchase <Badge tone="amber">credit</Badge>
                          </span>
                        ) : (
                          <span className="text-gray-500">
                            Purchase <Badge tone="green">paid</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.delta === 0 ? (
                          <span className="text-gray-400">—</span>
                        ) : r.delta > 0 ? (
                          <span className="text-amber-700">+{formatPaisa(r.delta)}</span>
                        ) : (
                          <span className="text-green-700">−{formatPaisa(-r.delta)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                        {formatPaisa(r.running)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
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
    </Modal>
  );
}
