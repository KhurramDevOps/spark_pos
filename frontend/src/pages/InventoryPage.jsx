import { useEffect, useState } from "react";
import { Button, TextInput, Select, Badge, ErrorText } from "../components/ui";
import { formatPaisa, decimalText } from "../lib/format";
import { useItems, useCategories, useDeactivateItem, useReactivateItem } from "../features/inventory/hooks";
import ItemForm from "../features/inventory/ItemForm";
import AdjustStockModal from "../features/inventory/AdjustStockModal";
import CategoryManager from "../features/inventory/CategoryManager";

const LIMIT = 20;

function isLowStock(item) {
  // Low only when a reorder level is set (spec 001 §8).
  if (!item.reorderLevel || item.reorderLevel <= 0) return false;
  return Number(decimalText(item.stockQty)) <= item.reorderLevel;
}

export default function InventoryPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [active, setActive] = useState("true");
  const [page, setPage] = useState(1);

  // Debounce the search box and reset to page 1 on any filter change.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => setPage(1), [search, categoryId, active]);

  const { data, isLoading, isError, error } = useItems({
    search,
    categoryId,
    active,
    page,
    limit: LIMIT,
  });
  const { data: categories = [] } = useCategories();
  const deactivateMut = useDeactivateItem();
  const reactivateMut = useReactivateItem();

  const [formItem, setFormItem] = useState(undefined); // undefined = closed, null = new
  const [adjustItem, setAdjustItem] = useState(null);
  const [showCategories, setShowCategories] = useState(false);
  const [rowError, setRowError] = useState("");

  const items = data?.items ?? [];
  const pages = data?.pages ?? 1;
  const total = data?.total ?? 0;

  async function toggleActive(item) {
    setRowError("");
    try {
      if (item.isActive) await deactivateMut.mutateAsync(item._id);
      else await reactivateMut.mutateAsync(item._id);
    } catch (err) {
      setRowError(err.message);
    }
  }

  const catName = (c) => (typeof c === "object" && c ? c.name : "—");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500">{total} item(s)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowCategories(true)}>
            Categories
          </Button>
          <Button onClick={() => setFormItem(null)} disabled={categories.filter((c) => c.isActive).length === 0}>
            + Add item
          </Button>
        </div>
      </header>

      {categories.filter((c) => c.isActive).length === 0 && (
        <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Create a category first (Categories button) before adding items.
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TextInput
          className="max-w-xs"
          placeholder="Search name or SKU…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <div className="w-48">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
            <option value="all">All</option>
          </Select>
        </div>
      </div>

      {rowError && <div className="mb-3"><ErrorText>{rowError}</ErrorText></div>}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">SKU</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium text-right">Stock</th>
              <th className="px-4 py-2 font-medium text-right">Retail</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            )}
            {isError && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-red-600">{error.message}</td></tr>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No items found.</td></tr>
            )}
            {items.map((item) => (
              <tr key={item._id} className={item.isActive ? "" : "bg-gray-50/60"}>
                <td className="px-4 py-2 font-mono text-xs text-gray-600">{item.sku}</td>
                <td className="px-4 py-2 font-medium text-gray-900">{item.name}</td>
                <td className="px-4 py-2 text-gray-600">{catName(item.categoryId)}</td>
                <td className="px-4 py-2 text-right">
                  <span className="tabular-nums">{decimalText(item.stockQty)}</span>{" "}
                  <span className="text-xs text-gray-400">{item.baseUnit}</span>
                  {isLowStock(item) && <span className="ml-2"><Badge tone="amber">low</Badge></span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatPaisa(item.retailPrice)}</td>
                <td className="px-4 py-2">
                  {item.isActive ? <Badge tone="green">active</Badge> : <Badge tone="red">inactive</Badge>}
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" onClick={() => setAdjustItem(item)}>Adjust</Button>
                    <Button variant="ghost" onClick={() => setFormItem(item)}>Edit</Button>
                    <Button
                      variant={item.isActive ? "danger" : "secondary"}
                      onClick={() => toggleActive(item)}
                    >
                      {item.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
        <span>Page {page} of {pages}</span>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>

      {formItem !== undefined && (
        <ItemForm item={formItem} categories={categories} onClose={() => setFormItem(undefined)} />
      )}
      {adjustItem && <AdjustStockModal item={adjustItem} onClose={() => setAdjustItem(null)} />}
      {showCategories && <CategoryManager onClose={() => setShowCategories(false)} />}
    </div>
  );
}
