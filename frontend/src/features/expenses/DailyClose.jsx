import { useState } from "react";
import { Field, TextInput, Button, ErrorText } from "../../components/ui";
import { saveDayCloseSchema } from "@shared/validation/expense.js";
import { formatPaisa, rupeesToPaisa } from "../../lib/format";
import { useDailyClose, useDailyCloseLine, useSaveDailyClose } from "./hooks";

const todayLabel = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

const fmtTime = (at) =>
  at ? new Date(at).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" }) : "";

/** Expanded list of the transactions behind one cash-math line (drill-down). */
function LineDetail({ date, line }) {
  const { data: rows, isLoading, isError, error } = useDailyCloseLine(date, line, true);
  if (isLoading) return <p className="py-1 pl-4 text-xs text-fg-subtle">Loading…</p>;
  if (isError) return <p className="py-1 pl-4 text-xs text-red-600">{error.message}</p>;
  if (!rows?.length) return <p className="py-1 pl-4 text-xs text-fg-subtle">No transactions.</p>;
  return (
    <div className="mb-1 ml-4 border-l border-line pl-3">
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline justify-between py-0.5 text-xs text-fg-muted">
          <span>
            {r.label} {r.at && <span className="text-fg-subtle">· {fmtTime(r.at)}</span>}
          </span>
          <span className="tabular-nums">{formatPaisa(r.amount)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * One line of the cash-math table. `sign` is "+", "−", or "" (totals). Pass
 * `line` + `date` to make it click-to-expand into its underlying transactions.
 */
function MathRow({ sign, label, paisa, bold, divider, line, date }) {
  const [open, setOpen] = useState(false);
  const drillable = Boolean(line);
  return (
    <>
      <button
        type="button"
        disabled={!drillable}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-baseline justify-between py-1.5 text-left text-sm ${
          divider ? "mt-1 border-t border-line pt-2" : ""
        } ${bold ? "font-semibold text-fg" : "text-fg-muted"} ${
          drillable ? "hover:text-accent" : "cursor-default"
        }`}
      >
        <span>
          {sign && <span className="mr-1 inline-block w-3 text-fg-subtle">{sign}</span>}
          {label}
          {drillable && <span className="ml-1 text-xs text-fg-subtle">{open ? "▾" : "▸"}</span>}
        </span>
        <span className="tabular-nums">{formatPaisa(paisa)}</span>
      </button>
      {open && drillable && <LineDetail date={date} line={line} />}
    </>
  );
}

/**
 * Daily close screen (spec 005 §6). Read-mostly: pulls the day's cash math fresh
 * from immutable sources, lets the owner type the counted cash, shows the
 * difference, and persists the close (carrying actualCash forward as tomorrow's
 * starting float). Drill-down-per-line is a deferred follow-up slice.
 */
export default function DailyClose({ initialDate } = {}) {
  // initialDate (YYYY-MM-DD) lets the Reports trend chart open a specific day.
  const [date, setDate] = useState(initialDate || todayLabel());
  const [actual, setActual] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");

  const { data, isLoading, isError, error } = useDailyClose(date);
  const saveMut = useSaveDailyClose();

  // When the saved close loads, seed the input with what was counted so re-saves
  // start from the previous count rather than blank.
  const savedActual = data?.close?.actualCash;

  if (isLoading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (isError) return <ErrorText>{error.message}</ErrorText>;

  const expectedPaisa = Number(data.expectedCash);
  const actualPaisa = actual.trim() !== "" ? rupeesToPaisa(actual) : savedActual != null ? Number(savedActual) : null;
  const difference = actualPaisa != null ? actualPaisa - expectedPaisa : null;
  const diffColor =
    difference == null ? "text-fg-subtle" : difference < 0 ? "text-red-600" : difference > 0 ? "text-green-600" : "text-fg-muted";

  // "Was the day worth it?" — green up, red down, neutral grey at exact break-even
  // (a zero-net day shouldn't be forced into red or green).
  const netPaisa = Number(data.netForDay);
  const netColor = netPaisa > 0 ? "text-green-600" : netPaisa < 0 ? "text-red-600" : "text-fg-muted";

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
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-fg">Cash math</h2>
          <MathRow label="Starting cash in drawer" paisa={data.startingCash} />
          <MathRow sign="+" label="Cash sales" paisa={data.cashSales} line="cashSales" date={date} />
          <MathRow sign="+" label="Customer payments received" paisa={data.customerPayments} line="customerPayments" date={date} />
          <MathRow sign="+" label="Drawer adjustments IN" paisa={data.drawerIn} line="drawerIn" date={date} />
          <MathRow sign="−" label="Cash refunds" paisa={data.cashRefunds} line="cashRefunds" date={date} />
          <MathRow sign="−" label="Supplier payments" paisa={data.supplierPayments} line="supplierPayments" date={date} />
          <MathRow sign="−" label="Expenses" paisa={data.expenses} line="expenses" date={date} />
          <MathRow sign="−" label="Drawer adjustments OUT" paisa={data.drawerOut} line="drawerOut" date={date} />
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
            {/* "Did the drawer balance?" — the dominant answer. Colour: red short,
                green over, grey at exact balance (and while uncounted). */}
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <div>
                <div className="text-sm font-medium text-fg-muted">Difference</div>
                {difference != null && (
                  <div className={`text-xs ${diffColor}`}>
                    {difference < 0 ? "drawer is short" : difference > 0 ? "drawer is over" : "drawer balances"}
                  </div>
                )}
              </div>
              <span className={`text-3xl font-semibold tabular-nums ${diffColor}`}>
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
              <p className="text-center text-xs text-fg-muted">
                Closed — counted {formatPaisa(data.close.actualCash)}, difference{" "}
                {formatPaisa(data.close.differenceSnapshot)}.
              </p>
            )}
          </div>
        </section>

        {/* Profit / expense / net */}
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-fg">Profit &amp; expenses</h2>
          <MathRow label="Gross profit today" paisa={data.grossProfit} />
          <MathRow sign="−" label="Expenses today" paisa={data.expenses} />
          {/* "Was the day worth it?" — the dominant answer. */}
          <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-sm font-medium text-fg-muted">Net for the day</span>
            <span className={`text-3xl font-semibold tabular-nums ${netColor}`}>{formatPaisa(data.netForDay)}</span>
          </div>
          <p className="mt-3 text-xs text-fg-muted">
            Gross profit is sales minus cost (weighted-average) for non-voided sales, adjusted
            for returns. Net is display-only — never folded into per-sale profit.
          </p>
        </section>
      </div>
    </div>
  );
}
