import { useState } from "react";
import { Modal, Field, TextInput, Button, ErrorText } from "../../components/ui";
import { decimalText } from "../../lib/format";
import { adjustStockSchema } from "@shared/validation/item.js";
import { useAdjustStock } from "./hooks";

export default function AdjustStockModal({ item, onClose }) {
  const mutation = useAdjustStock();
  const current = decimalText(item.stockQty);
  const [countedQty, setCountedQty] = useState(current);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");

  // Display-only preview of the change (the authoritative delta is computed server-side).
  let diffPreview = null;
  const c = Number(countedQty);
  const cur = Number(current);
  if (countedQty !== "" && Number.isFinite(c) && Number.isFinite(cur)) {
    const d = c - cur;
    diffPreview = d === 0 ? "no change" : `${d > 0 ? "+" : ""}${d}`;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});
    setServerError("");

    const result = adjustStockSchema.safeParse({ countedQty: countedQty.trim(), note: note.trim() });
    if (!result.success) {
      const fe = {};
      for (const issue of result.error.issues) fe[issue.path[0]] = issue.message;
      setErrors(fe);
      return;
    }

    try {
      await mutation.mutateAsync({ id: item._id, body: result.data });
      onClose();
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <Modal
      title={`Adjust stock — ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="adjust-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save adjustment"}
          </Button>
        </>
      }
    >
      <form id="adjust-form" onSubmit={handleSubmit} className="space-y-3">
        {serverError && <ErrorText>{serverError}</ErrorText>}

        <p className="text-sm text-gray-600">
          Current stock: <span className="font-semibold text-gray-900">{current}</span> {item.baseUnit}
        </p>

        <Field label="Counted quantity" error={errors.countedQty} hint="the actual quantity on the shelf">
          <TextInput value={countedQty} onChange={(e) => setCountedQty(e.target.value)} autoFocus />
        </Field>

        {diffPreview && (
          <p className="text-sm">
            Change:{" "}
            <span
              className={`font-semibold ${
                diffPreview.startsWith("-")
                  ? "text-red-600"
                  : diffPreview === "no change"
                    ? "text-gray-500"
                    : "text-green-600"
              }`}
            >
              {diffPreview}
            </span>
          </p>
        )}

        <Field label="Reason note" error={errors.note}>
          <TextInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. physical count correction"
          />
        </Field>
      </form>
    </Modal>
  );
}
