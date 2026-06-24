import { useState } from "react";
import { Badge, Button } from "../../components/ui";
import { decimalText, formatPaisa } from "../../lib/format";
import { formatBalance, CUSTOMER_BALANCE_LABELS } from "../../lib/balance";
import StatTiles from "../../components/StatTiles";
import { useCustomers, useSetCustomerActive } from "./hooks";
import CustomerForm from "./CustomerForm";
import CustomerDetail from "./CustomerDetail";

export default function CustomersList() {
  const [showInactive, setShowInactive] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState(null);

  const { data, isLoading, isError, error } = useCustomers(showInactive ? "all" : "true");
  const customers = data?.customers ?? [];
  const totals = data?.totals;
  const setActive = useSetCustomerActive();

  return (
    <div className="space-y-4">
      {totals && (
        <StatTiles
          tiles={[
            { label: "Total to receive", value: formatPaisa(totals.toReceive), className: "text-green-700" },
            { label: "Store credit outstanding", value: formatPaisa(totals.storeCredit), className: "text-amber-700" },
            { label: "Khata customers", value: totals.count },
          ]}
        />
      )}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-line"
          />
          Show inactive
        </label>
        <Button onClick={() => setShowNew(true)}>+ New customer</Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">Phone</th>
              <th className="px-4 py-2.5 text-right font-medium">Khata balance</th>
              <th className="px-4 py-2.5 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-fg-subtle">Loading…</td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-red-600">{error.message}</td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-fg-subtle">
                  No customers yet. Add one with “New customer”.
                </td>
              </tr>
            ) : (
              customers.map((c) => {
                const bal = formatBalance(decimalText(c.balance), CUSTOMER_BALANCE_LABELS);
                return (
                  <tr
                    key={c._id}
                    onClick={() => setOpenId(c._id)}
                    className="cursor-pointer hover:bg-muted"
                  >
                    <td className="px-4 py-2.5">
                      <span className="text-fg">{c.name}</span>
                      {!c.isActive && <span className="ml-2"><Badge tone="gray">Inactive</Badge></span>}
                    </td>
                    <td className="px-4 py-2.5 text-fg-muted">{c.phone || "—"}</td>
                    <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${bal.className}`}>
                      {bal.text}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        className="text-xs font-medium text-fg-muted hover:text-fg"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActive.mutate({ id: c._id, active: !c.isActive });
                        }}
                        disabled={setActive.isPending}
                      >
                        {c.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showNew && <CustomerForm onClose={() => setShowNew(false)} onSaved={(c) => setOpenId(c._id)} />}
      {openId && <CustomerDetail customerId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
