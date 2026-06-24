import { useState } from "react";
import { Badge, Button, Select, TextInput } from "../../components/ui";
import { formatPaisa, decimalText } from "../../lib/format";
import { usePurchases, useSuppliers } from "./hooks";
import PurchaseDetail from "./PurchaseDetail";

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-PK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Purchase history: filterable, paginated, click a row to see its lines. */
export default function PurchaseHistory() {
  const [supplierId, setSupplierId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);

  // Suppliers (incl. inactive) so older purchases can still be filtered by name.
  const { data: suppliersData } = useSuppliers("all");
  const suppliers = suppliersData?.suppliers ?? [];

  const filters = {
    supplierId: supplierId || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    limit: 20,
  };
  const { data, isLoading, isError, error, isFetching } = usePurchases(filters);

  const purchases = data?.purchases ?? [];
  const pages = data?.pages ?? 1;
  const total = data?.total ?? 0;

  const hasFilters = supplierId || from || to;
  function resetFilters() {
    setSupplierId("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  // Any filter change goes back to page 1.
  const onFilter = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-surface p-3">
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">Supplier</span>
          <Select value={supplierId} onChange={onFilter(setSupplierId)}>
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
                {s.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">From</span>
          <TextInput type="date" value={from} onChange={onFilter(setFrom)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">To</span>
          <TextInput type="date" value={to} onChange={onFilter(setTo)} />
        </label>
        {hasFilters && (
          <Button variant="ghost" onClick={resetFilters}>
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">Supplier</th>
              <th className="px-4 py-2.5 font-medium">Payment</th>
              <th className="px-4 py-2.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-fg-subtle">
                  Loading…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-red-600">
                  {error.message}
                </td>
              </tr>
            ) : purchases.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-fg-subtle">
                  {hasFilters
                    ? "No purchases match these filters."
                    : "No purchases yet. Record one with “New purchase”."}
                </td>
              </tr>
            ) : (
              purchases.map((p) => (
                <tr
                  key={p._id}
                  onClick={() => setOpenId(p._id)}
                  className="cursor-pointer hover:bg-muted"
                >
                  <td className="px-4 py-2.5 text-fg">{formatDate(p.date)}</td>
                  <td className="px-4 py-2.5 text-fg-muted">{p.supplierId?.name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      {p.paymentType === "credit" ? (
                        <Badge tone="amber">Credit</Badge>
                      ) : (
                        <Badge tone="green">Paid</Badge>
                      )}
                      {p.reversed && <Badge tone="gray">Reversed</Badge>}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                      p.reversed ? "text-fg-subtle line-through" : "text-fg"
                    }`}
                  >
                    {formatPaisa(decimalText(p.total))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-fg-muted">
        <span>
          {total} purchase{total === 1 ? "" : "s"}
          {isFetching && !isLoading ? " · updating…" : ""}
        </span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="tabular-nums">
              Page {page} of {pages}
            </span>
            <Button
              variant="secondary"
              disabled={page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {openId && <PurchaseDetail purchaseId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
