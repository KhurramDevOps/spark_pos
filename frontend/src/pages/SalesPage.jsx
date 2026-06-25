import { useState } from "react";
import { Button, TextInput, Select, ErrorText } from "../components/ui";
import { createSaleSchema } from "@shared/validation/sale.js";
import { decimalText, rupeesToPaisa, paisaToRupeesInput } from "../lib/format";
import ItemPicker from "../features/purchases/ItemPicker";
import { useCreateSale, useCustomers, useCreateCustomer } from "../features/sales/hooks";

let lineKey = 0;
const emptyLine = () => ({ key: ++lineKey, item: null, qty: "1", unitPrice: "" });

const rs = (n) =>
  `Rs ${Number(n).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Server-derived suggested price (paisa) mirrored client-side for prefill.
function suggestedPaisa(item, priceMode) {
  if (!item) return null;
  return priceMode === "wholesale" && item.wholesalePrice != null
    ? item.wholesalePrice
    : item.retailPrice;
}

// Per-line derived numbers (all from the item the client already has).
function lineCalc(l) {
  const cost = l.item ? Number(decimalText(l.item.avgCost)) : null; // paisa
  const pricePaisa = rupeesToPaisa(l.unitPrice); // null if blank/invalid
  const qty = Number(l.qty);
  const validQty = Number.isFinite(qty) && qty > 0;
  const ready = l.item && pricePaisa != null && validQty;
  const lineTotal = ready ? (pricePaisa * qty) / 100 : null; // rupees
  const belowCost = ready && cost != null && pricePaisa < cost;
  const losing = belowCost ? ((cost - pricePaisa) * qty) / 100 : 0; // rupees
  const profit = ready && cost != null ? ((pricePaisa - cost) * qty) / 100 : null;
  return { cost, pricePaisa, qty, ready, lineTotal, belowCost, losing, profit };
}

export default function SalesPage() {
  const [priceMode, setPriceMode] = useState("retail");
  const [paymentType, setPaymentType] = useState("cash");
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");
  const [result, setResult] = useState(null);
  const [newCustomer, setNewCustomer] = useState(null); // { name, openingBalance } | null

  const { data: customersData } = useCustomers("true");
  const customers = customersData?.customers ?? [];
  const createMut = useCreateSale();
  const createCustomerMut = useCreateCustomer();

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (key) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  // Pick an item -> prefill its unit price from the suggested price for this mode.
  function pickItem(key, item) {
    setLine(key, { item, unitPrice: paisaToRupeesInput(suggestedPaisa(item, priceMode)) });
  }
  // Switching price mode re-prefills every line's suggested price (still overridable).
  function changePriceMode(mode) {
    setPriceMode(mode);
    setLines((ls) =>
      ls.map((l) => (l.item ? { ...l, unitPrice: paisaToRupeesInput(suggestedPaisa(l.item, mode)) } : l))
    );
  }

  const calcs = lines.map(lineCalc);
  const grandTotal = calcs.reduce((s, c) => s + (c.lineTotal ?? 0), 0);
  const totalProfit = calcs.reduce((s, c) => s + (c.profit ?? 0), 0);

  async function createInlineCustomer() {
    setServerError("");
    try {
      const created = await createCustomerMut.mutateAsync({
        name: newCustomer.name.trim(),
        openingBalance: newCustomer.openingBalance.trim() || "0",
      });
      setCustomerId(created._id);
      setNewCustomer(null);
    } catch (err) {
      setServerError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");

    const payload = {
      paymentType,
      priceMode,
      lines: lines
        .filter((l) => l.item)
        .map((l) => ({ itemId: l.item._id, qty: l.qty.trim(), unitPrice: l.unitPrice.trim() })),
      ...(customerId ? { customerId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };

    const parsed = createSaleSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }

    try {
      const res = await createMut.mutateAsync(parsed.data);
      setResult(res);
    } catch (err) {
      setServerError(err.message);
    }
  }

  function newSale() {
    setResult(null);
    setLines([emptyLine()]);
    setNote("");
    setCustomerId("");
    setPaymentType("cash");
    setPriceMode("retail");
  }

  // ---- success panel ----
  if (result) {
    const { sale, customer } = result;
    // The create response returns line itemIds unpopulated; resolve names from the
    // cart we just submitted (still in state until "New sale").
    const nameById = {};
    lines.forEach((l) => { if (l.item) nameById[l.item._id] = l.item.name; });
    const profit = sale.lines.reduce(
      (s, l) =>
        s + (Number(decimalText(l.unitPrice)) - Number(decimalText(l.costAtTime))) * Number(decimalText(l.qty)) / 100,
      0
    );
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/50 px-4 py-3 text-sm text-green-800 dark:text-green-300">
          Sale recorded — {sale.paymentType === "credit" ? "added to khata" : "cash"}. Stock updated.
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sale.lines.map((l, i) => {
                const price = Number(decimalText(l.unitPrice));
                const cost = Number(decimalText(l.costAtTime));
                const qty = Number(decimalText(l.qty));
                const lp = ((price - cost) * qty) / 100;
                return (
                  <tr key={i}>
                    <td className="px-3 py-2 text-fg">{nameById[l.itemId] ?? l.itemId?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{rs(price / 100)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{rs(Number(decimalText(l.lineTotal)) / 100)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${lp < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
                      {rs(lp)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-line bg-muted font-medium">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right text-fg-muted">Total</td>
                <td className="px-3 py-2 text-right tabular-nums text-fg">{rs(Number(decimalText(sale.total)) / 100)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${profit < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>{rs(profit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {customer && (
          <p className="mt-3 text-sm text-fg-muted">
            {customer.name}'s khata balance is now{" "}
            <span className="font-medium">{rs(Number(decimalText(customer.balance)) / 100)}</span>.
          </p>
        )}
        <div className="mt-4">
          <Button onClick={newSale}>+ New sale</Button>
        </div>
      </div>
    );
  }

  // ---- POS form ----
  const creditNeedsCustomer = paymentType === "credit" && !customerId;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-fg">New sale</h1>
        <div className="inline-flex rounded-md border border-line p-0.5 text-sm">
          {["retail", "wholesale"].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => changePriceMode(m)}
              className={`rounded px-3 py-1 font-medium capitalize ${
                priceMode === m ? "bg-indigo-600 text-white" : "text-fg-muted hover:bg-muted"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </header>

      <form onSubmit={handleSubmit} className="space-y-4">
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText>
            <ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </ErrorText>
        )}

        {/* Cart lines */}
        <div className="space-y-2">
          {lines.map((l, idx) => {
            const c = calcs[idx];
            return (
              <div
                key={l.key}
                className={`rounded-md border p-2 ${
                  c.belowCost ? "border-red-300 dark:border-red-800 bg-red-50/40 dark:bg-red-950/40" : "border-line"
                }`}
              >
                <div className="mb-2">
                  <ItemPicker
                    selected={l.item}
                    autoFocus={idx === 0}
                    onSelect={(item) => pickItem(l.key, item)}
                    onClear={() => setLine(l.key, { item: null, unitPrice: "" })}
                  />
                </div>
                {l.item && (
                  <div className="mb-1 flex items-center gap-2 text-xs text-fg-subtle">
                    <span>in stock: {decimalText(l.item.stockQty)} {l.item.baseUnit}</span>
                    <span>·</span>
                    <span>cost {rs(Number(decimalText(l.item.avgCost)) / 100)}</span>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="w-24">
                    <span className="mb-1 block text-xs text-fg-muted">Qty{l.item ? ` (${l.item.baseUnit})` : ""}</span>
                    <TextInput value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} placeholder="1" />
                  </div>
                  <div className="flex-1">
                    <span className="mb-1 block text-xs text-fg-muted">Unit price (Rs)</span>
                    <TextInput
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.unitPrice}
                      onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="w-28 pb-2 text-right text-sm tabular-nums text-fg-muted">
                    {c.lineTotal != null ? rs(c.lineTotal) : "—"}
                  </div>
                  <button
                    type="button"
                    className="pb-2 text-fg-subtle hover:text-red-600 dark:text-red-400 disabled:opacity-30"
                    onClick={() => removeLine(l.key)}
                    disabled={lines.length <= 1}
                    aria-label="Remove line"
                  >
                    ✕
                  </button>
                </div>
                {c.belowCost && (
                  <div className="mt-2 flex items-center gap-1.5 rounded bg-red-100 dark:bg-red-950/60 px-2 py-1 text-sm font-semibold text-red-700 dark:text-red-300">
                    <span aria-hidden="true">▲</span>
                    Below cost — losing {rs(c.losing)}{c.qty > 1 ? " on this line" : ""}
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="text-sm font-medium text-accent hover:text-accent" onClick={addLine}>
            + Add item
          </button>
        </div>

        {/* Secondary fields — quieted so the cart + checkout dominate the eye path. */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-xs text-fg-muted">Payment</span>
            <Select value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="credit">Credit (udhaar)</option>
            </Select>
          </div>
          <div>
            <span className="mb-1 block text-xs text-fg-muted">Note (optional)</span>
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. delivered" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-muted">
              Customer{" "}
              {paymentType === "credit" ? (
                <span className="text-red-600 dark:text-red-400">(required for credit)</span>
              ) : (
                <span className="text-fg-subtle">(optional)</span>
              )}
            </span>
            {!newCustomer && (
              <button
                type="button"
                className="text-sm font-medium text-accent hover:text-accent"
                onClick={() => setNewCustomer({ name: "", openingBalance: "" })}
              >
                + New customer
              </button>
            )}
          </div>

          {newCustomer ? (
            <div className="mt-2 space-y-2">
              <TextInput
                placeholder="Customer name"
                value={newCustomer.name}
                onChange={(e) => setNewCustomer((s) => ({ ...s, name: e.target.value }))}
              />
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <span className="mb-1 block text-xs text-fg-muted">Opening balance owed (Rs, optional)</span>
                  <TextInput
                    value={newCustomer.openingBalance}
                    onChange={(e) => setNewCustomer((s) => ({ ...s, openingBalance: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <Button type="button" onClick={createInlineCustomer} disabled={!newCustomer.name.trim() || createCustomerMut.isPending}>
                  {createCustomerMut.isPending ? "Adding…" : "Add"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setNewCustomer(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— No customer —</option>
                {customers.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {/* Checkout: the eye path ends here — dominant Total to read aloud, then Complete.
            Profit is a small subordinate line (margin awareness, not the headline). */}
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-xs text-fg-muted">
                Profit{" "}
                <span className={`font-medium ${totalProfit < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>{rs(totalProfit)}</span>
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-sm text-fg-muted">Total</span>
                <span className="text-3xl font-semibold tabular-nums text-fg">{rs(grandTotal)}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {creditNeedsCustomer && <span className="text-xs text-red-600 dark:text-red-400">Pick a customer for a credit sale.</span>}
              <Button
                type="submit"
                disabled={createMut.isPending || creditNeedsCustomer}
                className="px-5 py-2.5 text-base"
              >
                {createMut.isPending ? "Saving…" : `Complete sale · ${rs(grandTotal)}`}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
