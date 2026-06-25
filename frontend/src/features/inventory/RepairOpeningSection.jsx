import { useState } from "react";
import { Field, TextInput, Button, Badge, ErrorText } from "../../components/ui";
import { rupeesToPaisa, paisaToRupeesInput, formatPaisa, decimalText } from "../../lib/format";
import { useItemOpening, useRepairOpeningCost } from "./hooks";

/**
 * Owner-only "Repair opening cost" panel inside Edit Item (spec 006c §4 path #4 /
 * decision #2). Red-tinted, co-located with the item's other repair actions.
 *
 * Surfaces the item's CURRENT opening — both the cost-bearing `opening` shape and
 * the legacy cost-less `adjustment` (§9.5), so a corrupt item doesn't look empty —
 * then lets the owner declare the correct unit cost. The backend deletes the old
 * opening (either shape), writes a new one ordered first, and replays avgCost.
 */
export default function RepairOpeningSection({ item }) {
  const { data, isLoading } = useItemOpening(item._id);
  const mut = useRepairOpeningCost();
  const opening = data?.opening ?? null;

  const [open, setOpen] = useState(false);
  const [unitCost, setUnitCost] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [report, setReport] = useState(null);

  // Prefill from the current opening (or current stock) when the panel opens.
  function startRepair() {
    setReport(null);
    setServerError("");
    setErrors({});
    setUnitCost(opening?.unitCost ? paisaToRupeesInput(opening.unitCost) : "");
    setQty(opening ? decimalText(opening.qty) : decimalText(item.stockQty));
    setOpen(true);
  }

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    setServerError("");

    const fieldErrors = {};
    const paisa = rupeesToPaisa(unitCost);
    if (paisa == null) fieldErrors.unitCost = "Enter a valid cost (Rs, 0 or more)";
    if (qty.trim() === "" || !/[1-9]/.test(qty)) fieldErrors.qty = "Quantity must be greater than 0";
    if (note.trim() === "") fieldErrors.note = "A note is required — explain the repair";
    if (Object.keys(fieldErrors).length) return setErrors(fieldErrors);

    try {
      const res = await mut.mutateAsync({
        id: item._id,
        body: { unitCost: String(paisa), qty: qty.trim(), note: note.trim() },
      });
      setReport(res);
      setOpen(false);
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <div className="mt-4 rounded-md border border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/40 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-red-800 dark:text-red-300">Repair opening cost</div>
        <Badge tone="red">Owner only</Badge>
      </div>

      {/* Current opening (both shapes) */}
      <div className="mt-2 text-xs text-red-900/80 dark:text-red-300/80">
        {isLoading ? (
          "Loading current opening…"
        ) : !opening ? (
          <>No opening declared. If this item's avgCost looks wrong, declare its real opening cost below.</>
        ) : opening.legacy ? (
          <>
            Current opening: <span className="font-medium">{decimalText(opening.qty)} {item.baseUnit}</span>{" "}
            <span className="font-semibold text-red-700 dark:text-red-300">— no cost recorded (legacy, needs repair)</span>
          </>
        ) : (
          <>
            Current opening: <span className="font-medium">
              {decimalText(opening.qty)} {item.baseUnit} @ {formatPaisa(opening.unitCost)}
            </span>{" "}
            <span className="text-red-900/60 dark:text-red-300/70">on {new Date(opening.date).toLocaleDateString()}</span>
          </>
        )}
      </div>

      {report && (
        <p className="mt-2 text-xs text-green-800 dark:text-green-300">
          Repaired. Avg cost {formatPaisa(report.before.avgCost)} → <span className="font-medium">{formatPaisa(report.after.avgCost)}</span>
          , stock {decimalText(report.before.stockQty)} → {decimalText(report.after.stockQty)} {item.baseUnit}.
        </p>
      )}

      {!open ? (
        <Button variant="danger" type="button" className="mt-2" onClick={startRepair}>
          {opening?.legacy ? "Fix this opening's cost" : "Declare / repair opening cost"}
        </Button>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          {serverError && <ErrorText>{serverError}</ErrorText>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Real unit cost (Rs)" error={errors.unitCost} hint="what you actually paid each">
              <TextInput type="number" step="0.01" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="250.00" />
            </Field>
            <Field label={`Quantity (${item.baseUnit})`} error={errors.qty} hint="defaults to current stock">
              <TextInput value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
            </Field>
          </div>
          <Field label="Reason (required)" error={errors.note}>
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. entered at cost 0 before; real cost was Rs 250" />
          </Field>
          <p className="text-xs text-red-900/70 dark:text-red-300/80">
            This replaces the item's opening and replays its average cost from history. Stock and avg
            cost may change.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" type="submit" disabled={mut.isPending}>
              {mut.isPending ? "Repairing…" : "Repair opening cost"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
