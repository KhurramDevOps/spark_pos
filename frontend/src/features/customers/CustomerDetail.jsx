import { useState } from "react";
import { Modal, Badge, Button } from "../../components/ui";
import { formatPaisa, decimalText } from "../../lib/format";
import { formatBalance, CUSTOMER_BALANCE_LABELS } from "../../lib/balance";
import { useCustomer, useCustomerPayments, useCustomerCreditSales } from "./hooks";
import CustomerPaymentForm from "./CustomerPaymentForm";
import CustomerForm from "./CustomerForm";

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Build a chronological khata ledger from CREDIT sales + payments, carrying a
 * running balance from openingBalance. Cash sales are settled on the spot and are
 * NOT part of udhaar — they never appear here and never affect the balance (spec
 * 004). Credit sales (+) and payments (−) move the balance.
 */
function buildLedger(openingBalance, creditSales, payments) {
  const events = [
    ...creditSales
      .filter((s) => s.paymentType === "credit") // defensive: khata is credit-only
      .map((s) => ({
        kind: "sale",
        id: s._id,
        date: s.date,
        createdAt: s.createdAt,
        amount: Number(decimalText(s.total)),
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

  // Order by posting time (createdAt) so the running balance is coherent — the
  // user-facing `date` can be date-only (midnight) and would otherwise sort a
  // same-day payment before the sale it follows.
  events.sort((a, b) => {
    const d = new Date(a.createdAt) - new Date(b.createdAt);
    if (d !== 0) return d;
    return new Date(a.date) - new Date(b.date);
  });

  let running = Number(openingBalance);
  const rows = events.map((e) => {
    const delta = e.kind === "payment" ? -e.amount : e.amount; // sale = credit only here
    running += delta;
    return { ...e, delta, running };
  });

  return rows.reverse(); // newest first
}

export default function CustomerDetail({ customerId, onClose }) {
  const [showPayment, setShowPayment] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const { data: customer, isLoading, error } = useCustomer(customerId);
  const { data: payments = [] } = useCustomerPayments(customerId);
  const { data: salesData } = useCustomerCreditSales(customerId);
  const creditSales = salesData?.sales ?? [];

  const opening = customer ? decimalText(customer.openingBalance) : "0";
  const rows = customer ? buildLedger(opening, creditSales, payments) : [];
  const bal = customer ? formatBalance(decimalText(customer.balance), CUSTOMER_BALANCE_LABELS) : null;
  const balanceNum = customer ? Number(decimalText(customer.balance)) : 0;
  const openingNum = Number(opening);

  return (
    <Modal
      title={customer ? customer.name : "Customer"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => setShowEdit(true)} disabled={!customer}>
            Edit
          </Button>
          <Button onClick={() => setShowPayment(true)} disabled={!customer}>
            Record payment
          </Button>
        </>
      }
    >
      {isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {customer && (
        <div className="space-y-4">
          {/* Header: balance + meta */}
          <div className="flex items-start justify-between rounded-md bg-muted p-3">
            <div className="text-sm text-fg-muted">
              {customer.phone ? <div>{customer.phone}</div> : <div className="text-fg-subtle">No phone</div>}
              {!customer.isActive && <Badge tone="gray">Inactive</Badge>}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-fg-subtle">Khata balance</div>
              <div className={`text-lg font-semibold ${bal.className}`}>{bal.text}</div>
              <div className="text-xs text-fg-subtle">
                {balanceNum > 0
                  ? "owes you"
                  : balanceNum < 0
                  ? "paid in advance — you owe them"
                  : "settled"}
              </div>
            </div>
          </div>

          {/* Khata ledger */}
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-fg">Khata</h3>
            <p className="mb-2 text-xs text-fg-muted">
              Running credit account — credit sales add, payments reduce.
            </p>
          </div>
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
                      No credit sales or payments yet.
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
                        ) : (
                          <span className="text-fg">
                            Sale <Badge tone="amber">credit</Badge>
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

      {showPayment && customer && (
        <CustomerPaymentForm customer={customer} onClose={() => setShowPayment(false)} />
      )}
      {showEdit && customer && (
        <CustomerForm customer={customer} onClose={() => setShowEdit(false)} />
      )}
    </Modal>
  );
}
