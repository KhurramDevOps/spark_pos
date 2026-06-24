import { useState } from "react";
import { Badge, Button } from "../../components/ui";
import { decimalText, formatPaisa } from "../../lib/format";
import { formatBalance } from "../../lib/balance";
import StatTiles from "../../components/StatTiles";
import { useSuppliers, useSetSupplierActive } from "./hooks";
import SupplierForm from "./SupplierForm";
import SupplierDetail from "./SupplierDetail";

export default function SuppliersList() {
  const [showInactive, setShowInactive] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState(null);

  const { data, isLoading, isError, error } = useSuppliers(showInactive ? "all" : "true");
  const suppliers = data?.suppliers ?? [];
  const totals = data?.totals;
  const setActive = useSetSupplierActive();

  return (
    <div className="space-y-4">
      {totals && (
        <StatTiles
          tiles={[
            { label: "Total to pay", value: formatPaisa(totals.toPay), className: "text-amber-700" },
            { label: "Advances paid", value: formatPaisa(totals.advances), className: "text-green-700" },
            { label: "Active suppliers", value: totals.activeCount },
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
        <Button onClick={() => setShowNew(true)}>+ New supplier</Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Supplier</th>
              <th className="px-4 py-2.5 font-medium">Phone</th>
              <th className="px-4 py-2.5 text-right font-medium">Balance</th>
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
            ) : suppliers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-fg-subtle">
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
                    className="cursor-pointer hover:bg-muted"
                  >
                    <td className="px-4 py-2.5">
                      <span className="text-fg">{s.name}</span>
                      {!s.isActive && <span className="ml-2"><Badge tone="gray">Inactive</Badge></span>}
                    </td>
                    <td className="px-4 py-2.5 text-fg-muted">{s.phone || "—"}</td>
                    <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${bal.className}`}>
                      {bal.text}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        className="text-xs font-medium text-fg-muted hover:text-fg"
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
