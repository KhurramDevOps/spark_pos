import { useState } from "react";
import { Modal, Field, TextInput, Select, Button, ErrorText } from "../../components/ui";
import { createPurchaseSchema } from "@shared/validation/purchase.js";
import { apiClient } from "../../lib/apiClient";
import { formatPaisa, decimalText } from "../../lib/format";
import { useCreatePurchase, useSuppliers, useCreateSupplier } from "./hooks";
import ItemPicker from "./ItemPicker";

let lineKey = 0;
const emptyLine = () => ({ key: ++lineKey, item: null, qty: "", unitCost: "" });

// Display-only line total in rupees (server is authoritative). null if incomplete.
function lineRupees(l) {
  const q = Number(l.qty);
  const c = Number(l.unitCost);
  if (!l.item || !Number.isFinite(q) || !Number.isFinite(c) || l.qty === "" || l.unitCost === "") return null;
  return q * c;
}

export default function PurchaseForm({ onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [paymentType, setPaymentType] = useState("cash");
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");
  const [result, setResult] = useState(null); // success panel

  const { data: suppliersData } = useSuppliers("true");
  const suppliers = suppliersData?.suppliers ?? [];
  const createMut = useCreatePurchase();

  // Inline "new supplier" (kept out of the way unless needed).
  const [newSupplier, setNewSupplier] = useState(null); // { name, openingBalance } | null
  const createSupplierMut = useCreateSupplier();

  const setLine = (key, patch) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (key) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const grandRupees = lines.reduce((sum, l) => sum + (lineRupees(l) ?? 0), 0);

  async function createInlineSupplier() {
    setServerError("");
    try {
      const created = await createSupplierMut.mutateAsync({
        name: newSupplier.name.trim(),
        openingBalance: newSupplier.openingBalance.trim() || "0",
      });
      setSupplierId(created._id);
      setNewSupplier(null);
    } catch (err) {
      setServerError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");

    const payload = {
      date,
      paymentType,
      lines: lines
        .filter((l) => l.item)
        .map((l) => ({ itemId: l.item._id, qty: l.qty.trim(), unitCost: l.unitCost.trim() })),
      ...(supplierId ? { supplierId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };

    const parsed = createPurchaseSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }

    try {
      await createMut.mutateAsync(parsed.data);
      // Fetch the affected items fresh so the owner can watch avgCost/stock move.
      const ids = [...new Set(payload.lines.map((l) => l.itemId))];
      const items = await Promise.all(ids.map((id) => apiClient.get(`/items/${id}`)));
      setResult({ items, grandRupees });
    } catch (err) {
      setServerError(err.message);
    }
  }

  // ---- success panel ----
  if (result) {
    return (
      <Modal
        title="Purchase recorded"
        onClose={onClose}
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Stock increased and weighted-average cost updated for{" "}
            {result.items.length} item(s):
          </p>
          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium text-right">New stock</th>
                  <th className="px-3 py-2 font-medium text-right">New avg cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.items.map((it) => (
                  <tr key={it._id}>
                    <td className="px-3 py-2 text-gray-900">{it.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {decimalText(it.stockQty)} <span className="text-xs text-gray-400">{it.baseUnit}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatPaisa(decimalText(it.avgCost))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    );
  }

  // ---- entry form ----
  return (
    <Modal
      title="New purchase"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="purchase-form" disabled={createMut.isPending}>
            {createMut.isPending ? "Saving…" : "Record purchase"}
          </Button>
        </>
      }
    >
      <form id="purchase-form" onSubmit={handleSubmit} className="space-y-4">
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText>
            <ul className="list-disc pl-4">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </ErrorText>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Payment">
            <Select value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
              <option value="cash">Cash (paid)</option>
              <option value="credit">Credit (owe supplier)</option>
            </Select>
          </Field>
        </div>

        {/* Line items — the main event */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Items</span>
            <button type="button" className="text-sm font-medium text-indigo-600 hover:text-indigo-700" onClick={addLine}>
              + Add line
            </button>
          </div>
          {lines.map((l, idx) => {
            const lt = lineRupees(l);
            return (
              <div key={l.key} className="rounded-md border border-gray-200 p-2">
                <div className="mb-2">
                  <ItemPicker
                    selected={l.item}
                    autoFocus={idx === 0}
                    onSelect={(item) => setLine(l.key, { item })}
                    onClear={() => setLine(l.key, { item: null })}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <span className="mb-1 block text-xs text-gray-500">
                      Quantity{l.item ? ` (${l.item.baseUnit})` : ""}
                    </span>
                    <TextInput value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} placeholder="e.g. 100" />
                  </div>
                  <div className="flex-1">
                    <span className="mb-1 block text-xs text-gray-500">Unit cost (Rs)</span>
                    <TextInput
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.unitCost}
                      onChange={(e) => setLine(l.key, { unitCost: e.target.value })}
                      placeholder="110.50"
                    />
                  </div>
                  <div className="w-28 pb-2 text-right text-sm tabular-nums text-gray-700">
                    {lt != null ? `Rs ${lt.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                  </div>
                  <button
                    type="button"
                    className="pb-2 text-gray-400 hover:text-red-600 disabled:opacity-30"
                    onClick={() => removeLine(l.key)}
                    disabled={lines.length <= 1}
                    aria-label="Remove line"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
          <div className="flex justify-end pr-8 text-sm">
            <span className="text-gray-500">Grand total:&nbsp;</span>
            <span className="font-semibold tabular-nums text-gray-900">
              Rs {grandRupees.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Supplier — optional, present but not in the way */}
        <div className="rounded-md bg-gray-50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              Supplier {paymentType === "credit" ? <span className="text-red-600">(required for credit)</span> : <span className="text-gray-400">(optional)</span>}
            </span>
            {!newSupplier && (
              <button
                type="button"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                onClick={() => setNewSupplier({ name: "", openingBalance: "" })}
              >
                + New supplier
              </button>
            )}
          </div>

          {newSupplier ? (
            <div className="mt-2 space-y-2">
              <TextInput
                placeholder="Supplier name"
                value={newSupplier.name}
                onChange={(e) => setNewSupplier((s) => ({ ...s, name: e.target.value }))}
              />
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <span className="mb-1 block text-xs text-gray-500">Opening balance owed (Rs, optional)</span>
                  <TextInput
                    value={newSupplier.openingBalance}
                    onChange={(e) => setNewSupplier((s) => ({ ...s, openingBalance: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <Button
                  type="button"
                  onClick={createInlineSupplier}
                  disabled={!newSupplier.name.trim() || createSupplierMut.isPending}
                >
                  {createSupplierMut.isPending ? "Adding…" : "Add"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setNewSupplier(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— No supplier —</option>
                {suppliers.map((s) => (
                  <option key={s._id} value={s._id}>{s.name}</option>
                ))}
              </Select>
            </div>
          )}
        </div>

        <Field label="Note (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. invoice #" />
        </Field>
      </form>
    </Modal>
  );
}
