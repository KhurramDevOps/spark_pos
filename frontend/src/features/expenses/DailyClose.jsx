import { useState } from "react";
import { Field, TextInput, Button, ErrorText } from "../../components/ui";
import { saveDayCloseSchema } from "@shared/validation/expense.js";
import { formatPaisa, rupeesToPaisa } from "../../lib/format";
import { useDailyClose, useSaveDailyClose } from "./hooks";

const todayLabel = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

/** One line of the cash-math table. `sign` is "+", "−", or "" (totals). */
function MathRow({ sign, label, paisa, bold, divider }) {
  return (
    <div
      className={`flex items-baseline justify-between py-1.5 text-sm ${
        divider ? "border-t border-gray-200 mt-1 pt-2" : ""
      } ${bold ? "font-semibold text-gray-900" : "text-gray-700"}`}
    >
      <span>
        {sign && <span className="mr-1 inline-block w-3 text-gray-400">{sign}</span>}
        {label}
      </span>
      <span className="tabular-nums">{formatPaisa(paisa)}</span>
    </div>
  );
}

/**
 * Daily close screen (spec 005 §6). Read-mostly: pulls the day's cash math fresh
 * from immutable sources, lets the owner type the counted cash, shows the
 * difference, and persists the close (carrying actualCash forward as tomorrow's
 * starting float). Drill-down-per-line is a deferred follow-up slice.
 */
export default function DailyClose() {
  const [date, setDate] = useState(todayLabel());
  const [actual, setActual] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");

  const { data, isLoading, isError, error } = useDailyClose(date);
  const saveMut = useSaveDailyClose();

  // When the saved close loads, seed the input with what was counted so re-saves
  // start from the previous count rather than blank.
  const savedActual = data?.close?.actualCash;

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (isError) return <ErrorText>{error.message}</ErrorText>;

  const expectedPaisa = Number(data.expectedCash);
  const actualPaisa = actual.trim() !== "" ? rupeesToPaisa(actual) : savedActual != null ? Number(savedActual) : null;
  const difference = actualPaisa != null ? actualPaisa - expectedPaisa : null;
  const diffColor =
    difference == null ? "text-gray-400" : difference < 0 ? "text-red-600" : difference > 0 ? "text-green-600" : "text-gray-500";

  async function handleClose() {
    setErrors([]);
    setServerError("");
    const payload = { date, actualCash: (actual.trim() || (savedActual != null ? String(Number(savedActual) / 100) : "")).trim(), note: note.trim() || undefined };
    const parsed = saveDayCloseSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }
    try {
      await saveMut.mutateAsync(parsed.data);
      setActual("");
      setNote("");
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <div className="space-y-5">
      {/* Date picker */}
      <div className="flex items-end gap-3">
        <Field label="Day">
          <TextInput type="date" max={todayLabel()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {date !== todayLabel() && (
          <Button variant="secondary" type="button" onClick={() => setDate(todayLabel())}>
            Today
          </Button>
        )}
      </div>

      {/* Hints */}
      {data.unClosedDays > 0 && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {data.unClosedDays} day(s) since the last close — starting cash may not line up
          until those days are closed too.
        </p>
      )}
      {data.close?.stale && (
        <p className="rounded bg-orange-50 px-3 py-2 text-sm text-orange-800">
          This close is <strong>stale</strong>: a sale, return, or expense on this day
          changed after it was closed. The counted cash ({formatPaisa(data.close.actualCash)})
          still carries forward — re-save to refresh the audit snapshot.
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {/* Cash math */}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Cash math</h2>
          <MathRow label="Starting cash in drawer" paisa={data.startingCash} />
          <MathRow sign="+" label="Cash sales" paisa={data.cashSales} />
          <MathRow sign="+" label="Customer payments received" paisa={data.customerPayments} />
          <MathRow sign="+" label="Drawer adjustments IN" paisa={data.drawerIn} />
          <MathRow sign="−" label="Cash refunds" paisa={data.cashRefunds} />
          <MathRow sign="−" label="Supplier payments" paisa={data.supplierPayments} />
          <MathRow sign="−" label="Expenses" paisa={data.expenses} />
          <MathRow sign="−" label="Drawer adjustments OUT" paisa={data.drawerOut} />
          <MathRow label="Expected cash in drawer" paisa={data.expectedCash} bold divider />

          <div className="mt-4 space-y-3">
            <Field label="Actual cash counted (Rs)">
              <TextInput
                type="number"
                step="0.01"
                min="0"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                placeholder={savedActual != null ? (Number(savedActual) / 100).toFixed(2) : "0.00"}
              />
            </Field>
            <div className="flex items-baseline justify-between text-sm font-semibold">
              <span>Difference</span>
              <span className={`tabular-nums ${diffColor}`}>
                {difference == null ? "—" : formatPaisa(difference)}
              </span>
            </div>
            <Field label="Note (optional)">
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="explain a discrepancy" />
            </Field>
            {serverError && <ErrorText>{serverError}</ErrorText>}
            {errors.length > 0 && (
              <ErrorText>
                <ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </ErrorText>
            )}
            <Button type="button" onClick={handleClose} disabled={saveMut.isPending} className="w-full">
              {saveMut.isPending ? "Saving…" : data.close ? "Re-save close" : "Close day"}
            </Button>
            {data.close && !data.close.stale && (
              <p className="text-center text-xs text-gray-500">
                Closed — counted {formatPaisa(data.close.actualCash)}, difference{" "}
                {formatPaisa(data.close.differenceSnapshot)}.
              </p>
            )}
          </div>
        </section>

        {/* Profit / expense / net */}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Profit &amp; expenses</h2>
          <MathRow label="Gross profit today" paisa={data.grossProfit} />
          <MathRow sign="−" label="Expenses today" paisa={data.expenses} />
          <MathRow label="Net for the day" paisa={data.netForDay} bold divider />
          <p className="mt-3 text-xs text-gray-500">
            Gross profit is sales minus cost (weighted-average) for non-voided sales, adjusted
            for returns. Net is display-only — never folded into per-sale profit.
          </p>
        </section>
      </div>
    </div>
  );
}
