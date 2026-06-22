import { useState } from "react";
import { Modal, Field, TextInput, Button, ErrorText } from "../../components/ui";
import { createCustomerSchema, updateCustomerSchema } from "@shared/validation/customer.js";
import { useCreateCustomer, useUpdateCustomer } from "./hooks";

/**
 * Create or edit a customer. In edit mode only name/phone are editable —
 * openingBalance is an immutable starting point (spec 004 §5). Mirrors SupplierForm.
 */
export default function CustomerForm({ customer, onClose, onSaved }) {
  const isEdit = Boolean(customer);
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [openingBalance, setOpeningBalance] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");

  const createMut = useCreateCustomer();
  const updateMut = useUpdateCustomer();
  const pending = createMut.isPending || updateMut.isPending;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");

    if (isEdit) {
      const payload = { name: name.trim(), phone: phone.trim() ? phone.trim() : null };
      const parsed = updateCustomerSchema.safeParse(payload);
      if (!parsed.success) {
        setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
        return;
      }
      try {
        const saved = await updateMut.mutateAsync({ id: customer._id, ...parsed.data });
        onSaved?.(saved);
        onClose();
      } catch (err) {
        setServerError(err.message);
      }
      return;
    }

    const payload = {
      name: name.trim(),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      openingBalance: openingBalance.trim() || "0",
    };
    const parsed = createCustomerSchema.safeParse(payload);
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
      title={isEdit ? "Edit customer" : "New customer"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="customer-form" disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create customer"}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={handleSubmit} className="space-y-4">
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText>
            <ul className="list-disc pl-4">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </ErrorText>
        )}

        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rafiq Electronics" autoFocus />
        </Field>
        <Field label="Phone (optional)">
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
        </Field>
        {!isEdit && (
          <Field
            label="Opening balance owed (Rs, optional)"
            hint="What this customer already owes you when adding them. Defaults to 0."
          >
            <TextInput
              type="number"
              step="0.01"
              min="0"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              placeholder="0"
            />
          </Field>
        )}
      </form>
    </Modal>
  );
}
