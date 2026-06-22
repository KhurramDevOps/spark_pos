import { useState } from "react";
import { Badge, Button } from "../../components/ui";
import { decimalText } from "../../lib/format";
import { formatBalance } from "../../lib/balance";
import { useSuppliers, useSetSupplierActive } from "./hooks";
import SupplierForm from "./SupplierForm";
import SupplierDetail from "./SupplierDetail";

export default function SuppliersList() {
  const [showInactive, setShowInactive] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState(null);

  const { data: suppliers = [], isLoading, isError, error } = useSuppliers(
    showInactive ? "all" : "true"
  );
  const setActive = useSetSupplierActive();

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
        <Button onClick={() => setShowNew(true)}>+ New supplier</Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Supplier</th>
              <th className="px-4 py-2.5 font-medium">Phone</th>
              <th className="px-4 py-2.5 text-right font-medium">Balance</th>
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
            ) : suppliers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">
                  No suppliers yet. Add one with “New supplier”.
                </td>
              </tr>
            ) : (
              suppliers.map((s) => {
                const bal = formatBalance(decimalText(s.balance));
                return (
                  <tr
                    key={s._id}
                    onClick={() => setOpenId(s._id)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-4 py-2.5">
                      <span className="text-gray-900">{s.name}</span>
                      {!s.isActive && <span className="ml-2"><Badge tone="gray">Inactive</Badge></span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{s.phone || "—"}</td>
                    <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${bal.className}`}>
                      {bal.text}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        className="text-xs font-medium text-gray-500 hover:text-gray-800"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActive.mutate({ id: s._id, active: !s.isActive });
                        }}
                        disabled={setActive.isPending}
                      >
                        {s.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showNew && <SupplierForm onClose={() => setShowNew(false)} onSaved={(s) => setOpenId(s._id)} />}
      {openId && <SupplierDetail supplierId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
