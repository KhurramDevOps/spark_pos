import { useState } from "react";
import { Modal, Field, TextInput, Button, ErrorText } from "../../components/ui";
import { createSupplierSchema, updateSupplierSchema } from "@shared/validation/supplier.js";
import { useCreateSupplier, useUpdateSupplier } from "./hooks";

/**
 * Create or edit a supplier. In edit mode only name/phone are editable —
 * openingBalance is an immutable starting point (spec 003 §5).
 */
export default function SupplierForm({ supplier, onClose, onSaved }) {
  const isEdit = Boolean(supplier);
  const [name, setName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [openingBalance, setOpeningBalance] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");

  const createMut = useCreateSupplier();
  const updateMut = useUpdateSupplier();
  const pending = createMut.isPending || updateMut.isPending;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");

    if (isEdit) {
      const payload = { name: name.trim(), phone: phone.trim() ? phone.trim() : null };
      const parsed = updateSupplierSchema.safeParse(payload);
      if (!parsed.success) {
        setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
        return;
      }
      try {
        const saved = await updateMut.mutateAsync({ id: supplier._id, ...parsed.data });
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
    const parsed = createSupplierSchema.safeParse(payload);
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
      title={isEdit ? "Edit supplier" : "New supplier"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="supplier-form" disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create supplier"}
          </Button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={handleSubmit} className="space-y-4">
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText>
            <ul className="list-disc pl-4">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </ErrorText>
        )}

        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Karachi Electronics" autoFocus />
        </Field>
        <Field label="Phone (optional)">
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
        </Field>
        {!isEdit && (
          <Field
            label="Opening balance owed (Rs, optional)"
            hint="What you already owe this supplier when adding them. Defaults to 0."
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
