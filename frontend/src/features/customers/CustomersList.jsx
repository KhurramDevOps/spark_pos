import { useState } from "react";
import { Badge, Button } from "../../components/ui";
import { decimalText } from "../../lib/format";
import { formatBalance, CUSTOMER_BALANCE_LABELS } from "../../lib/balance";
import { useCustomers, useSetCustomerActive } from "./hooks";
import CustomerForm from "./CustomerForm";
import CustomerDetail from "./CustomerDetail";

export default function CustomersList() {
  const [showInactive, setShowInactive] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState(null);

  const { data: customers = [], isLoading, isError, error } = useCustomers(
    showInactive ? "all" : "true"
  );
  const setActive = useSetCustomerActive();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-gray-300"
          />
          Show inactive
        </label>
        <Button onClick={() => setShowNew(true)}>+ New customer</Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">Phone</th>
              <th className="px-4 py-2.5 text-right font-medium">Khata balance</th>
              <th className="px-4 py-2.5 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">Loading…</td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-red-600">{error.message}</td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">
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
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-4 py-2.5">
                      <span className="text-gray-900">{c.name}</span>
                      {!c.isActive && <span className="ml-2"><Badge tone="gray">Inactive</Badge></span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{c.phone || "—"}</td>
                    <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${bal.className}`}>
                      {bal.text}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        className="text-xs font-medium text-gray-500 hover:text-gray-800"
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
