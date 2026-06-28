import { useState } from "react";
import { Modal, Field, TextInput, Select, Button, ErrorText } from "../../components/ui";
import { customerAdjustmentSchema } from "@shared/validation/customer.js";
import { formatBalance, CUSTOMER_BALANCE_LABELS } from "../../lib/balance";
import { decimalText } from "../../lib/format";
import { useRecordCustomerAdjustment } from "./hooks";

/**
 * Record a khata balance correction (spec 010). NOT a payment — it never counts as
 * cash. The owner picks a direction (increase/decrease what they owe) + amount + a
 * required reason; the server maps the toggle to a signed paisa amount.
 */
export default function CustomerAdjustmentForm({ customer, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [direction, setDirection] = useState("increase");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today);
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");

  const mut = useRecordCustomerAdjustment();
  const bal = formatBalance(decimalText(customer.balance), CUSTOMER_BALANCE_LABELS);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");

    const payload = { direction, amount: amount.trim(), reason: reason.trim(), date };
    const parsed = customerAdjustmentSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }
    try {
      await mut.mutateAsync({ id: customer._id, ...parsed.data });
      onClose();
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <Modal
      title={`Adjust khata — ${customer.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="customer-adjustment-form" disabled={mut.isPending}>
            {mut.isPending ? "Saving…" : "Record adjustment"}
          </Button>
        </>
      }
    >
      <form id="customer-adjustment-form" onSubmit={handleSubmit} className="space-y-4">
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText>
            <ul className="list-disc pl-4">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </ErrorText>
        )}

        <p className="text-sm text-fg-muted">
          Correct a wrong khata balance (e.g. a mistyped opening balance). This is a recorded
          adjustment, not a payment — it does <span className="font-medium">not</span> count as cash
          in the daily close.
        </p>
        <p className="text-sm text-fg-muted">
          Current balance: <span className={`font-medium ${bal.className}`}>{bal.text}</span>
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Direction">
            <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="increase">Increase what they owe</option>
              <option value="decrease">Decrease what they owe</option>
            </Select>
          </Field>
          <Field label="Amount (Rs)">
            <TextInput
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 450"
              autoFocus
            />
          </Field>
        </div>
        <Field label="Reason">
          <TextInput
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. corrected opening balance: was 5,000, should be 50,000"
          />
        </Field>
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
