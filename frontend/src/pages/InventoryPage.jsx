import { useEffect, useState } from "react";
import { Button, TextInput, Select, Badge, ErrorText } from "../components/ui";
import { formatPaisa, decimalText } from "../lib/format";
import { useItems, useCategories, useDeactivateItem, useReactivateItem } from "../features/inventory/hooks";
import ItemForm from "../features/inventory/ItemForm";
import AdjustStockModal from "../features/inventory/AdjustStockModal";
import CategoryManager from "../features/inventory/CategoryManager";
import ImportModal from "../features/inventory/ImportModal";
import RecalculateCostModal from "../features/inventory/RecalculateCostModal";
import ItemImage from "../components/ItemImage";

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
  const [noImage, setNoImage] = useState(false);
  const [page, setPage] = useState(1);

  // Debounce the search box; resetting to page 1 happens where each filter
  // changes (here in the debounce callback, and in the select handlers below).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, error } = useItems({
    search,
    categoryId,
    active,
    noImage,
    page,
    limit: LIMIT,
  });
  const { data: categories = [] } = useCategories();
  const deactivateMut = useDeactivateItem();
  const reactivateMut = useReactivateItem();

  const [formItem, setFormItem] = useState(undefined); // undefined = closed, null = new
  const [adjustItem, setAdjustItem] = useState(null);
  const [recalcItem, setRecalcItem] = useState(null);
  const [showCategories, setShowCategories] = useState(false);
  const [showImport, setShowImport] = useState(false);
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
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold text-fg">Inventory</h1>
          <span className="text-sm text-fg-subtle">{total} item{total === 1 ? "" : "s"}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowCategories(true)}>
            Categories
          </Button>
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            Import CSV
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
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
            <option value="all">All</option>
          </Select>
        </div>
        <button
          type="button"
          onClick={() => { setNoImage((v) => !v); setPage(1); }}
          className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
            noImage
              ? "border-accent bg-indigo-50 text-accent"
              : "border-line text-fg-muted hover:text-fg-muted"
          }`}
        >
          Without image
        </button>
      </div>

      {rowError && <div className="mb-3"><ErrorText>{rowError}</ErrorText></div>}

      {/* Table */}
      <div className="rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-2 font-medium"><span className="sr-only">Image</span></th>
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium text-right">Stock</th>
              <th className="px-4 py-2 font-medium text-right">Avg cost</th>
              <th className="px-4 py-2 font-medium text-right">Retail</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-fg-subtle">Loading…</td></tr>
            )}
            {isError && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-red-600">{error.message}</td></tr>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-fg-subtle">No items found.</td></tr>
            )}
            {items.map((item) => {
              const qty = Number(decimalText(item.stockQty));
              // Color the stock number itself when it needs attention — never a
              // separate badge. Red = negative (an error), amber = at/below reorder.
              const stockClass =
                qty < 0 ? "font-medium text-red-600"
                : isLowStock(item) ? "font-medium text-amber-600"
                : "text-fg";
              return (
              <tr key={item._id} className={item.isActive ? "" : "bg-muted/60"}>
                <td className="py-2.5 pl-4 pr-0 align-top">
                  <ItemImage image={item.image} size={48} hover alt={item.name} />
                </td>
                {/* Row anchor: name on top, SKU auxiliary below; image top-aligns to the name. */}
                <td className="px-4 py-2.5 align-top">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-fg">{item.name}</span>
                    {!item.isActive && <Badge tone="gray">Inactive</Badge>}
                  </div>
                  <div className="font-mono text-xs text-fg-subtle">{item.sku}</div>
                </td>
                <td className="px-4 py-2.5 align-top text-fg-muted">{catName(item.categoryId)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 align-top text-right">
                  <span className={`tabular-nums ${stockClass}`}>{decimalText(item.stockQty)}</span>{" "}
                  <span className="text-xs text-fg-subtle">{item.baseUnit}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 align-top text-right tabular-nums text-fg-muted">{formatPaisa(decimalText(item.avgCost))}</td>
                <td className="whitespace-nowrap px-4 py-2.5 align-top text-right tabular-nums font-medium text-fg">{formatPaisa(item.retailPrice)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 align-top">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" onClick={() => setAdjustItem(item)}>Adjust</Button>
                    <Button variant="ghost" onClick={() => setFormItem(item)}>Edit</Button>
                    <Button variant="ghost" title="Owner-only: replay avg cost from history" onClick={() => setRecalcItem(item)}>Recalc</Button>
                    <Button variant="ghost" onClick={() => toggleActive(item)}>
                      {item.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between text-sm text-fg-muted">
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
      {recalcItem && <RecalculateCostModal item={recalcItem} onClose={() => setRecalcItem(null)} />}
      {showCategories && <CategoryManager onClose={() => setShowCategories(false)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
