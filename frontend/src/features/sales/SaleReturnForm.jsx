import { useMemo, useState } from "react";
import { Modal, Field, TextInput, Select, Button, ErrorText } from "../../components/ui";
import { decimalText } from "../../lib/format";
import { useCustomers } from "./hooks";
import { useSaleReturns, useRecordSaleReturn } from "./hooks";

const rs = (paisa) => `Rs ${(Number(paisa) / 100).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Record a customer return against a sale (spec 004b). Pre-filled with the sale's
 * lines; each line's return qty is capped at what's still returnable (sold − already
 * returned). Refund cash or khata-credit (credit needs a customer).
 */
export default function SaleReturnForm({ sale, onClose }) {
  const { data: priorReturns = [] } = useSaleReturns(sale._id);
  const { data: customers = [] } = useCustomers("true");
  const mut = useRecordSaleReturn();

  // Already-returned qty per item across prior returns on this sale.
  const returnedByItem = useMemo(() => {
    const m = {};
    for (const r of priorReturns) for (const l of r.lines) {
      const k = String(l.itemId?._id ?? l.itemId);
      m[k] = (m[k] ?? 0) + Number(decimalText(l.qty));
    }
    return m;
  }, [priorReturns]);

  // One editable row per sale line (collapsed to per-item remaining).
  const initialRows = useMemo(
    () =>
      sale.lines.map((l) => {
        const itemId = String(l.itemId?._id ?? l.itemId);
        const sold = Number(decimalText(l.qty));
        const remaining = Math.max(0, sold - (returnedByItem[itemId] ?? 0));
        return {
          itemId,
          name: l.itemId?.name ?? "—",
          baseUnit: l.itemId?.baseUnit ?? "",
          unitPrice: Number(decimalText(l.unitPrice)),
          sold,
          remaining,
          qty: "",
        };
      }),
    [sale, returnedByItem]
  );
  const [rows, setRows] = useState(initialRows);
  const [refundMethod, setRefundMethod] = useState(sale.paymentType === "credit" ? "khata-credit" : "cash");
  const [customerId, setCustomerId] = useState(sale.customerId?._id ?? sale.customerId ?? "");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");

  const setQty = (itemId, qty) => setRows((rs) => rs.map((r) => (r.itemId === itemId ? { ...r, qty } : r)));

  const refundTotal = rows.reduce((s, r) => {
    const q = Number(r.qty);
    return s + (Number.isFinite(q) && q > 0 ? q * r.unitPrice : 0);
  }, 0) / 100;

  const needsCustomer = refundMethod === "khata-credit" && !customerId;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");
    const errs = [];
    const lines = [];
    for (const r of rows) {
      if (!r.qty.trim()) continue;
      const q = Number(r.qty);
      if (!Number.isFinite(q) || q <= 0) errs.push(`${r.name}: qty must be greater than 0`);
      else if (q > r.remaining) errs.push(`${r.name}: only ${r.remaining} ${r.baseUnit} returnable`);
      else lines.push({ itemId: r.itemId, qty: r.qty.trim() });
    }
    if (lines.length === 0) errs.push("Enter a return quantity for at least one item.");
    if (refundMethod === "khata-credit" && !customerId) errs.push("Pick a customer for khata-credit.");
    if (errs.length) { setErrors(errs); return; }

    const body = {
      lines,
      refundMethod,
      ...(refundMethod === "khata-credit" && customerId ? { customerId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    try {
      await mut.mutateAsync({ id: sale._id, ...body });
      onClose();
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <Modal
      title="Record return"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="sale-return-form" disabled={mut.isPending}>
            {mut.isPending ? "Saving…" : `Refund ${rs(refundTotal * 100)}`}
          </Button>
        </>
      }
    >
      <form id="sale-return-form" onSubmit={handleSubmit} className="space-y-4">
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText><ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></ErrorText>
        )}

        <p className="text-sm text-gray-500">How much of this sale is coming back?</p>

        <div className="overflow-hidden rounded-md border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Returnable</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Return qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.itemId}>
                  <td className="px-3 py-2 text-gray-900">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.remaining} {r.baseUnit}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{rs(r.unitPrice)}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50"
                      value={r.qty}
                      onChange={(e) => setQty(r.itemId, e.target.value)}
                      placeholder="0"
                      disabled={r.remaining <= 0}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Refund method">
            <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="khata-credit">Khata credit</option>
            </Select>
          </Field>
          {refundMethod === "khata-credit" && (
            <Field label="Customer" error={needsCustomer ? "required" : undefined}>
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— Select customer —</option>
                {customers.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Note (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. faulty unit" />
        </Field>
      </form>
    </Modal>
  );
}
