import { useState } from "react";
import { Modal, Field, TextInput, Button, Badge, ErrorText } from "../../components/ui";
import { createCategorySchema } from "@shared/validation/category.js";
import {
  useCategories,
  useCreateCategory,
  useDeactivateCategory,
  useReactivateCategory,
} from "./hooks";

export default function CategoryManager({ onClose }) {
  const { data: categories = [] } = useCategories();
  const createMut = useCreateCategory();
  const deactivateMut = useDeactivateCategory();
  const reactivateMut = useReactivateCategory();

  const [name, setName] = useState("");
  const [skuPrefix, setSkuPrefix] = useState("");
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");

  async function handleCreate(e) {
    e.preventDefault();
    setErrors({});
    setServerError("");
    const payload = { name: name.trim() };
    if (skuPrefix.trim()) payload.skuPrefix = skuPrefix.trim();

    const result = createCategorySchema.safeParse(payload);
    if (!result.success) {
      const fe = {};
      for (const issue of result.error.issues) fe[issue.path[0]] = issue.message;
      setErrors(fe);
      return;
    }
    try {
      await createMut.mutateAsync(result.data);
      setName("");
      setSkuPrefix("");
    } catch (err) {
      setServerError(err.message);
    }
  }

  async function toggle(cat) {
    setServerError("");
    try {
      if (cat.isActive) await deactivateMut.mutateAsync(cat._id);
      else await reactivateMut.mutateAsync(cat._id);
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <Modal title="Categories" onClose={onClose}>
      {serverError && <ErrorText>{serverError}</ErrorText>}

      <form onSubmit={handleCreate} className="mb-4 flex items-end gap-2">
        <div className="flex-1">
          <Field label="New category" error={errors.name}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fans" />
          </Field>
        </div>
        <div className="w-28">
          <Field label="Prefix" error={errors.skuPrefix} hint="auto if blank">
            <TextInput
              value={skuPrefix}
              onChange={(e) => setSkuPrefix(e.target.value.toUpperCase())}
              placeholder="FAN"
              maxLength={4}
            />
          </Field>
        </div>
        <Button type="submit" disabled={createMut.isPending} className="mb-[1px]">
          Add
        </Button>
      </form>

      <ul className="divide-y divide-gray-100">
        {categories.map((c) => (
          <li key={c._id} className="flex items-center justify-between py-2">
            <span className="flex items-center gap-2">
              <span className={c.isActive ? "text-gray-900" : "text-gray-400 line-through"}>
                {c.name}
              </span>
              <Badge>{c.skuPrefix}</Badge>
              {!c.isActive && <Badge tone="red">inactive</Badge>}
            </span>
            <Button variant={c.isActive ? "danger" : "secondary"} onClick={() => toggle(c)}>
              {c.isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </li>
        ))}
        {categories.length === 0 && (
          <li className="py-4 text-center text-sm text-gray-400">No categories yet.</li>
        )}
      </ul>
    </Modal>
  );
}
