import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchItems } from "../inventory/api";
import { TextInput } from "../../components/ui";
import ItemImage from "../../components/ItemImage";
import { decimalText, formatPaisa } from "../../lib/format";
import { stockLabel } from "../../lib/stock";

/**
 * Search-and-pick a single item by name or SKU (active items only). Once picked,
 * shows the selection with a "change" affordance.
 */
export default function ItemPicker({ selected, onSelect, onClear, autoFocus }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["item-search", q.trim()],
    queryFn: () => searchItems(q.trim(), 8),
    enabled: open && q.trim().length > 0,
  });
  const results = data?.items ?? [];

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <ItemImage image={selected.image} size={28} alt={selected.name} />
          <span className="truncate">
            <span className="font-medium text-fg">{selected.name}</span>{" "}
            <span className="font-mono text-xs text-fg-muted">{selected.sku}</span>
          </span>
        </span>
        <button type="button" className="text-xs font-medium text-accent hover:text-accent" onClick={onClear}>
          change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <TextInput
        placeholder="Search item by name or SKU…"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && q.trim() && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-line bg-surface shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-fg-subtle">No matches</div>
          ) : (
            results.map((it) => (
              <button
                type="button"
                key={it._id}
                onMouseDown={() => {
                  onSelect(it);
                  setOpen(false);
                  setQ("");
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ItemImage image={it.image} size={40} hover alt={it.name} />
                  <span className="truncate">
                    <span className="font-medium text-fg">{it.name}</span>{" "}
                    <span className="font-mono text-xs text-fg-muted">{it.sku}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-fg-subtle">
                  {it.bundle ? stockLabel(it) : `${decimalText(it.stockQty)} ${it.baseUnit}`}
                  {it.bundle && (
                    <span className="block font-semibold text-indigo-600 dark:text-indigo-300">
                      {formatPaisa(it.retailPrice)} /gaz
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
