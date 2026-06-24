import { useState } from "react";
import { Badge, Button, Select, TextInput } from "../../components/ui";
import { formatPaisa, decimalText } from "../../lib/format";
import { saleItemsLabel } from "@shared/sales/itemsLabel.js";
import { useSales, useCustomers } from "./hooks";
import SaleDetail from "./SaleDetail";

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "numeric" });
}

// Profit (paisa) for a sale row from its stored line snapshots: Σ (price − cost) × qty.
function saleProfitPaisa(sale) {
  return sale.lines.reduce(
    (s, l) =>
      s + (Number(decimalText(l.unitPrice)) - Number(decimalText(l.costAtTime))) * Number(decimalText(l.qty)),
    0
  );
}

/** Sale history: filter by customer / date range / payment, paginated server-side. */
export default function SaleHistory() {
  const [customerId, setCustomerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [paymentType, setPaymentType] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);

  // Customers incl. inactive so older sales stay filterable by name.
  const { data: customersData } = useCustomers("all");
  const customers = customersData?.customers ?? [];

  const filters = {
    customerId: customerId || undefined,
    from: from || undefined,
    to: to || undefined,
    paymentType: paymentType || undefined,
    page,
    limit: 20,
  };
  const { data, isLoading, isError, error, isFetching } = useSales(filters);

  const sales = data?.sales ?? [];
  const pages = data?.pages ?? 1;
  const total = data?.total ?? 0;

  const hasFilters = customerId || from || to || paymentType;
  function resetFilters() {
    setCustomerId("");
    setFrom("");
    setTo("");
    setPaymentType("");
    setPage(1);
  }
  const onFilter = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-surface p-3">
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">Customer</span>
          <Select value={customerId} onChange={onFilter(setCustomerId)}>
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
                {c.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">Payment</span>
          <Select value={paymentType} onChange={onFilter(setPaymentType)}>
            <option value="">All</option>
            <option value="cash">Cash</option>
            <option value="credit">Credit</option>
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
          <Button variant="ghost" onClick={resetFilters}>Clear</Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">Items</th>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">Payment</th>
              <th className="px-4 py-2.5 text-right font-medium">Total</th>
              <th className="px-4 py-2.5 text-right font-medium">Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-fg-subtle">Loading…</td></tr>
            ) : isError ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-red-600">{error.message}</td></tr>
            ) : sales.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-fg-subtle">
                  {hasFilters ? "No sales match these filters." : "No sales yet. Ring one up on the Sales screen."}
                </td>
              </tr>
            ) : (
              sales.map((s) => {
                const profit = saleProfitPaisa(s);
                return (
                  <tr key={s._id} onClick={() => setOpenId(s._id)} className="cursor-pointer hover:bg-muted">
                    <td className="px-4 py-2.5 text-fg">{formatDate(s.date)}</td>
                    <td className="px-4 py-2.5 text-fg-muted">{saleItemsLabel(s)}</td>
                    <td className="px-4 py-2.5 text-fg-muted">{s.customerId?.name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        {s.paymentType === "credit" ? <Badge tone="amber">Credit</Badge> : <Badge tone="green">Cash</Badge>}
                        {s.voided && <Badge tone="gray">Voided</Badge>}
                        {!s.voided && s.returnCount > 0 && (
                          <span className="text-xs font-medium text-fg-muted">
                            ↩ Returned {formatPaisa(decimalText(s.returnedTotal))}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${s.voided ? "text-fg-subtle line-through" : "text-fg"}`}>
                      {formatPaisa(decimalText(s.total))}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${s.voided ? "text-fg-subtle line-through" : profit < 0 ? "text-red-600" : "text-green-700"}`}>
                      {formatPaisa(Math.round(profit))}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-fg-muted">
        <span>
          {total} sale{total === 1 ? "" : "s"}
          {isFetching && !isLoading ? " · updating…" : ""}
        </span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <span className="tabular-nums">Page {page} of {pages}</span>
            <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
              Next
            </Button>
          </div>
        )}
      </div>

      {openId && <SaleDetail saleId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
