import { useState } from "react";
import { Modal, Field, TextInput, Select, Button, ErrorText } from "../../components/ui";
import { createDrawerAdjustmentSchema } from "@shared/validation/expense.js";
import { useCreateDrawerAdjustment } from "./hooks";

const DIRECTIONS = [
  { value: "in", label: "Cash IN — home → drawer" },
  { value: "out", label: "Cash OUT — drawer → home" },
];

const todayLabel = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

/**
 * Record cash moving between the drawer and home (spec 005 §4). "in" = brought
 * cash from home (e.g. to cover a supplier payment); "out" = took cash home for
 * the night. Neither is a sale, expense, or payment — its own concept. Flat insert.
 */
export default function DrawerAdjustmentForm({ onClose, onSaved }) {
  const [direction, setDirection] = useState("out");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLabel());
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");

  const createMut = useCreateDrawerAdjustment();

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");

    const payload = {
      direction,
      amount: amount.trim(),
      date,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const parsed = createDrawerAdjustmentSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }
    try {
      const saved = await createMut.mutateAsync(parsed.data);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <Modal
      title="Record drawer adjustment"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="drawer-form" disabled={createMut.isPending}>
            {createMut.isPending ? "Saving…" : "Record adjustment"}
          </Button>
        </>
      }
    >
      <form id="drawer-form" onSubmit={handleSubmit} className="space-y-4">
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText>
            <ul className="list-disc pl-4">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </ErrorText>
        )}

        <Field label="Direction">
          <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
            {DIRECTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
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
            placeholder="e.g. for Rafiq supplier payment"
          />
        </Field>
      </form>
    </Modal>
  );
}
