import { useState } from "react";
import { Modal, Field, TextInput, Select, Button, ErrorText } from "../../components/ui";
import { createExpenseSchema, updateExpenseSchema } from "@shared/validation/expense.js";
import { paisaToRupeesInput } from "../../lib/format";
import { useCreateExpense, useUpdateExpense } from "./hooks";

const CATEGORIES = [
  { value: "salary", label: "Salary" },
  { value: "electricity", label: "Electricity" },
  { value: "other", label: "Other" },
];

const todayLabel = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

/**
 * Record or edit a shop expense (spec 005 §4). Flat — category + amount + note.
 * Amount entered in rupees; the schema/server convert to paisa. No future dates
 * (§7). Editing a past-day expense changes that day's expected cash, so we warn.
 */
export default function ExpenseForm({ expense, onClose, onSaved }) {
  const isEdit = Boolean(expense);
  const [category, setCategory] = useState(expense?.category ?? "salary");
  const [amount, setAmount] = useState(
    expense ? paisaToRupeesInput(expense.amount?.$numberDecimal ?? expense.amount) : ""
  );
  const [date, setDate] = useState(
    expense?.date ? expense.date.slice(0, 10) : todayLabel()
  );
  const [note, setNote] = useState(expense?.note ?? "");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");

  const createMut = useCreateExpense();
  const updateMut = useUpdateExpense();
  const pending = createMut.isPending || updateMut.isPending;

  // §4: a closed day's expenses stay editable, but the owner should know the
  // cascade. We can't cheaply tell "is this day closed" here, so warn whenever
  // editing a past-day expense.
  const editingPastDay = isEdit && date < todayLabel();

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");

    const payload = {
      category,
      amount: amount.trim(),
      date,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const schema = isEdit ? updateExpenseSchema : createExpenseSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }
    try {
      const saved = isEdit
        ? await updateMut.mutateAsync({ id: expense._id, ...parsed.data })
        : await createMut.mutateAsync(parsed.data);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <Modal
      title={isEdit ? "Edit expense" : "Record expense"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="expense-form" disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Record expense"}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={handleSubmit} className="space-y-4">
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText>
            <ul className="list-disc pl-4">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </ErrorText>
        )}
        {editingPastDay && (
          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Editing a past-day expense will change that day's expected cash and affect
            the carried-forward float. Re-check that day's close.
          </p>
        )}

        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (Rs)">
          <TextInput
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </Field>
        <Field label="Date">
          <TextInput
            type="date"
            max={todayLabel()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Note (optional)">
          <TextInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. June worker salary"
          />
        </Field>
      </form>
    </Modal>
  );
}
