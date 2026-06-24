import { useState } from "react";
import { Modal, Field, TextInput, Button, ErrorText } from "../../components/ui";
import { customerPaymentSchema } from "@shared/validation/customer.js";
import { formatBalance, CUSTOMER_BALANCE_LABELS } from "../../lib/balance";
import { decimalText } from "../../lib/format";
import { useRecordCustomerPayment } from "./hooks";

/** Record a payment received from a customer — decreases their khata balance. */
export default function CustomerPaymentForm({ customer, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");

  const mut = useRecordCustomerPayment();
  const bal = formatBalance(decimalText(customer.balance), CUSTOMER_BALANCE_LABELS);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");

    const payload = {
      amount: amount.trim(),
      date,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const parsed = customerPaymentSchema.safeParse(payload);
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
      title={`Record payment — ${customer.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="customer-payment-form" disabled={mut.isPending}>
            {mut.isPending ? "Saving…" : "Record payment"}
          </Button>
        </>
      }
    >
      <form id="customer-payment-form" onSubmit={handleSubmit} className="space-y-4">
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText>
            <ul className="list-disc pl-4">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </ErrorText>
        )}

        <p className="text-sm text-fg-muted">
          Current balance: <span className={`font-medium ${bal.className}`}>{bal.text}</span>
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount received (Rs)">
            <TextInput
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 5000"
              autoFocus
            />
          </Field>
          <Field label="Date">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Note (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. cash / bank transfer ref" />
        </Field>
      </form>
    </Modal>
  );
}
