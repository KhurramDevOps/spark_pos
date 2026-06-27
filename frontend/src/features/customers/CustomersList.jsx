import { useEffect, useState } from "react";
import { Badge, Button, TextInput } from "../../components/ui";
import { useAuth } from "../auth/useAuth";
import { decimalText, formatPaisa } from "../../lib/format";
import { formatBalance, CUSTOMER_BALANCE_LABELS } from "../../lib/balance";
import StatTiles from "../../components/StatTiles";
import { useCustomers, useSetCustomerActive } from "./hooks";
import CustomerForm from "./CustomerForm";
import CustomerDetail from "./CustomerDetail";

export default function CustomersList() {
  // Edit/deactivate are owner-only (server 403s them — slice 7); workers still
  // get read + record-payment. Hide the controls rather than show a 403 toast.
  const { isOwner } = useAuth();
  const [showInactive, setShowInactive] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState(null);

  // Debounced name search (mirrors InventoryPage). `searchInput` is the live box;
  // `search` is what we actually query, updated 300ms after typing stops.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, error } = useCustomers(showInactive ? "all" : "true", search);
  const customers = data?.customers ?? [];
  const totals = data?.totals;
  const setActive = useSetCustomerActive();

  return (
    <div className="space-y-4">
      {totals && (
        <StatTiles
          tiles={[
            { label: "Total to receive", value: formatPaisa(totals.toReceive), className: "text-green-700 dark:text-green-400" },
            { label: "Store credit outstanding", value: formatPaisa(totals.storeCredit), className: "text-amber-700 dark:text-amber-400" },
            { label: "Khata customers", value: totals.count },
          ]}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-fg-subtle">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
            <TextInput
              className="w-56 pl-9"
              placeholder="Search by name…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search customers by name"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-line"
            />
            Show inactive
          </label>
        </div>
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
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-red-600 dark:text-red-400">{error.message}</td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-fg-subtle">
                  {search
                    ? `No customers match “${search}”.`
                    : "No customers yet. Add one with “New customer”."}
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
                      {isOwner && (
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
                      )}
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
