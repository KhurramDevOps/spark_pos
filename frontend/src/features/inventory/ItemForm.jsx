import { useState } from "react";
import { Modal, Field, TextInput, Select, Button, ErrorText } from "../../components/ui";
import { rupeesToPaisa, paisaToRupeesInput } from "../../lib/format";
import { BASE_UNITS, createItemSchema, updateItemSchema } from "@shared/validation/item.js";
import { useCreateItem, useUpdateItem } from "./hooks";
import ImageEditor from "./ImageEditor";
import RepairOpeningSection from "./RepairOpeningSection";

export default function ItemForm({ item, categories, onClose }) {
  const isEdit = Boolean(item);
  const createMut = useCreateItem();
  const updateMut = useUpdateItem();
  const mutation = isEdit ? updateMut : createMut;

  const [form, setForm] = useState(() => ({
    name: item?.name ?? "",
    categoryId: item?.categoryId?._id ?? item?.categoryId ?? "",
    baseUnit: item?.baseUnit ?? "piece",
    retailPrice: item ? paisaToRupeesInput(item.retailPrice) : "",
    wholesalePrice: item?.wholesalePrice != null ? paisaToRupeesInput(item.wholesalePrice) : "",
    reorderLevel: String(item?.reorderLevel ?? 0),
    notes: item?.notes ?? "",
    sku: item?.sku ?? "",
    openingQty: "0",
    imageUrl: "", // create-mode only; edit-mode image is handled by ImageEditor
  }));
  // Opening declaration (create-only, collapsed by default — spec 006c decision #1).
  const [showOpening, setShowOpening] = useState(false);
  const [openingUnitCost, setOpeningUnitCost] = useState("");
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const activeCategories = categories.filter((c) => c.isActive);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});
    setServerError("");

    // Build the payload in API terms (prices as integer paisa).
    const payload = {
      name: form.name.trim(),
      categoryId: form.categoryId,
      baseUnit: form.baseUnit,
      retailPrice: rupeesToPaisa(form.retailPrice),
      reorderLevel: Number(form.reorderLevel) || 0,
    };
    payload.wholesalePrice =
      form.wholesalePrice.trim() === "" ? (isEdit ? null : undefined) : rupeesToPaisa(form.wholesalePrice);
    payload.notes = form.notes.trim() === "" ? (isEdit ? null : undefined) : form.notes.trim();
    if (form.sku.trim()) payload.sku = form.sku.trim();
    if (!isEdit) {
      // Opening stock is paired with its unit cost (spec 006c). Only send the
      // fields when the owner has opened the section AND entered a qty; the schema
      // enforces the pairing (cost required when qty set) and surfaces the error.
      if (showOpening && /[1-9]/.test(form.openingQty)) {
        payload.openingQty = form.openingQty.trim();
        const paisa = rupeesToPaisa(openingUnitCost);
        if (paisa != null) payload.openingUnitCost = String(paisa);
      } else {
        payload.openingQty = "0";
      }
      // Create-mode image is URL-only (uploads need an existing item id).
      if (form.imageUrl.trim()) payload.image = { kind: "url", ref: form.imageUrl.trim() };
    }

    // Drop undefined keys so optional fields validate cleanly.
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const schema = isEdit ? updateItemSchema : createItemSchema;
    const result = schema.safeParse(payload);
    if (!result.success) {
      const fieldErrors = {};
      for (const issue of result.error.issues) fieldErrors[issue.path[0]] = issue.message;
      setErrors(fieldErrors);
      return;
    }

    try {
      if (isEdit) await updateMut.mutateAsync({ id: item._id, body: result.data });
      else await createMut.mutateAsync(result.data);
      onClose();
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <Modal
      title={isEdit ? `Edit ${item.name}` : "Add item"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="item-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Create item"}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={handleSubmit} className="space-y-3">
        {serverError && <ErrorText>{serverError}</ErrorText>}

        <Field label="Name" error={errors.name}>
          <TextInput value={form.name} onChange={set("name")} placeholder="e.g. GM 7/29 wire" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" error={errors.categoryId}>
            <Select value={form.categoryId} onChange={set("categoryId")}>
              <option value="">Select…</option>
              {activeCategories.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Base unit"
            error={errors.baseUnit}
            hint={isEdit ? "Locked once stock has moved" : undefined}
          >
            <Select value={form.baseUnit} onChange={set("baseUnit")}>
              {BASE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Retail price (Rs)" error={errors.retailPrice}>
            <TextInput
              type="number"
              step="0.01"
              min="0"
              value={form.retailPrice}
              onChange={set("retailPrice")}
              placeholder="120.00"
            />
          </Field>
          <Field label="Wholesale price (Rs)" error={errors.wholesalePrice} hint="optional">
            <TextInput
              type="number"
              step="0.01"
              min="0"
              value={form.wholesalePrice}
              onChange={set("wholesalePrice")}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Reorder level" error={errors.reorderLevel} hint="0 = no low-stock alert">
            <TextInput type="number" min="0" value={form.reorderLevel} onChange={set("reorderLevel")} />
          </Field>
        </div>

        {!isEdit && (
          <div className="rounded-md border border-gray-200 p-3">
            {!showOpening ? (
              <button
                type="button"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                onClick={() => setShowOpening(true)}
              >
                + Declare opening stock
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Opening stock</span>
                  <button
                    type="button"
                    className="text-xs text-gray-400 hover:text-gray-600"
                    onClick={() => {
                      setShowOpening(false);
                      setForm((f) => ({ ...f, openingQty: "0" }));
                      setOpeningUnitCost("");
                    }}
                  >
                    Remove
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Declare inventory you already have, with its real per-unit cost — no fake purchase
                  needed. Both fields are required together.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Opening qty" error={errors.openingQty} hint={`in ${form.baseUnit}; e.g. 2.5`}>
                    <TextInput value={form.openingQty} onChange={set("openingQty")} placeholder="0" />
                  </Field>
                  <Field label="Unit cost (Rs)" error={errors.openingUnitCost} hint="what you paid each">
                    <TextInput
                      type="number"
                      step="0.01"
                      min="0"
                      value={openingUnitCost}
                      onChange={(e) => setOpeningUnitCost(e.target.value)}
                      placeholder="0.00"
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>
        )}

        <Field label="SKU" error={errors.sku} hint={isEdit ? undefined : "leave blank to auto-generate"}>
          <TextInput value={form.sku} onChange={set("sku")} placeholder="auto (e.g. WIRE-0001)" />
        </Field>

        <Field label="Notes" error={errors.notes}>
          <TextInput value={form.notes} onChange={set("notes")} />
        </Field>

        <Field label="Image" error={errors.image}>
          {isEdit ? (
            <ImageEditor item={item} />
          ) : (
            <>
              <TextInput value={form.imageUrl} onChange={set("imageUrl")} placeholder="Paste an image URL (https://…)" />
              <p className="mt-1 text-xs text-gray-400">
                Uploading from your computer becomes available once the item is created.
              </p>
            </>
          )}
        </Field>
      </form>

      {/* Owner-only repair lives OUTSIDE the create/update form (its own form, no
          nesting). Spec 006c decision #2: red-tinted section inside Edit Item. */}
      {isEdit && <RepairOpeningSection item={item} />}
    </Modal>
  );
}
