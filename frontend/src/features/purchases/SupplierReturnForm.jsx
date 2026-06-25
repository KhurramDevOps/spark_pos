import { useState } from "react";
import { Modal, Field, TextInput, Button, ErrorText } from "../../components/ui";
import { createSupplierReturnSchema } from "@shared/validation/supplierReturn.js";
import { formatPaisa, decimalText } from "../../lib/format";
import { formatBalance } from "../../lib/balance";
import { useRecordReturn } from "./hooks";
import ItemPicker from "./ItemPicker";

let lineKey = 0;
const emptyLine = () => ({ key: ++lineKey, item: null, qty: "" });

/** Record a supplier return: pick item(s) + qty to send back. Cost basis (the
 *  current avgCost) is captured server-side; the average does NOT change. */
export default function SupplierReturnForm({ supplier, onClose }) {
  const [lines, setLines] = useState([emptyLine()]);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");
  const [result, setResult] = useState(null);

  const mut = useRecordReturn();

  const setLine = (key, patch) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (key) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");

    const payload = {
      lines: lines.filter((l) => l.item).map((l) => ({ itemId: l.item._id, qty: l.qty.trim() })),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const parsed = createSupplierReturnSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }

    try {
      const res = await mut.mutateAsync({ id: supplier._id, ...parsed.data });
      setResult(res);
    } catch (err) {
      setServerError(err.message);
    }
  }

  // ---- success panel: proves stock dropped + avg unchanged + balance moved ----
  if (result) {
    const bal = formatBalance(decimalText(result.supplier.balance));
    return (
      <Modal
        title="Return recorded"
        onClose={onClose}
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            Stock reduced for {result.items.length} item(s). Average cost is unchanged — a return
            removes stock at the current average.
          </p>
          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">New stock</th>
                  <th className="px-3 py-2 text-right font-medium">Avg cost (unchanged)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.items.map((it) => (
                  <tr key={it._id}>
                    <td className="px-3 py-2 text-fg">{it.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {decimalText(it.stockQty)} <span className="text-xs text-fg-subtle">{it.baseUnit}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatPaisa(decimalText(it.avgCost))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm">
            Return value: <span className="font-medium">{formatPaisa(decimalText(result.supplierReturn.total))}</span>.
            Balance now: <span className={`font-medium ${bal.className}`}>{bal.text}</span>
            {result.supplierReturn.refundDue ? " (refund due)" : ""}.
          </p>
        </div>
      </Modal>
    );
  }

  // ---- entry form ----
  return (
    <Modal
      title={`Record return — ${supplier.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="return-form" disabled={mut.isPending}>
            {mut.isPending ? "Saving…" : "Record return"}
          </Button>
        </>
      }
    >
      <form id="return-form" onSubmit={handleSubmit} className="space-y-4">
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText>
            <ul className="list-disc pl-4">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </ErrorText>
        )}

        <p className="text-sm text-fg-muted">
          Send stock back to {supplier.name}. This reduces stock and what you owe; the item's
          average cost stays the same.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-fg-muted">Items to return</span>
            <button type="button" className="text-sm font-medium text-accent hover:text-accent" onClick={addLine}>
              + Add line
            </button>
          </div>
          {lines.map((l, idx) => (
            <div key={l.key} className="rounded-md border border-line p-2">
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
                  <span className="mb-1 block text-xs text-fg-muted">
                    Quantity to return{l.item ? ` (${l.item.baseUnit})` : ""}
                  </span>
                  <TextInput value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} placeholder="e.g. 30" />
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
            </div>
          ))}
        </div>

        <Field label="Note (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. faulty batch" />
        </Field>
      </form>
    </Modal>
  );
}
