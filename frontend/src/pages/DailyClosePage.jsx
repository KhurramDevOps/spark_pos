import { useState } from "react";
import { Button, Badge } from "../components/ui";
import { formatPaisa } from "../lib/format";
import DailyClose from "../features/expenses/DailyClose";
import ExpenseForm from "../features/expenses/ExpenseForm";
import DrawerAdjustmentForm from "../features/expenses/DrawerAdjustmentForm";
import { useExpenses, useDeleteExpense } from "../features/expenses/hooks";

const CATEGORY_TONE = { salary: "green", electricity: "amber", other: "gray" };

function ExpensesList({ onEdit }) {
  const { data: expenses = [], isLoading } = useExpenses();
  const deleteMut = useDeleteExpense();

  if (isLoading) return <p className="text-sm text-gray-500">Loading expenses…</p>;
  if (expenses.length === 0)
    return <p className="text-sm text-gray-500">No expenses recorded yet.</p>;

  async function handleDelete(exp) {
    if (!window.confirm("Delete this expense? This changes that day's expected cash.")) return;
    await deleteMut.mutateAsync(exp._id);
  }

  return (
    <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {expenses.map((exp) => (
        <div key={exp._id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-3">
            <Badge tone={CATEGORY_TONE[exp.category] ?? "gray"}>{exp.category}</Badge>
            <span className="text-gray-500">{exp.date?.slice(0, 10)}</span>
            {exp.note && <span className="text-gray-400">— {exp.note}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="tabular-nums font-medium text-gray-900">
              {formatPaisa(exp.amount?.$numberDecimal ?? exp.amount)}
            </span>
            <button className="text-xs text-indigo-600 hover:underline" onClick={() => onEdit(exp)}>
              Edit
            </button>
            <button
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
              onClick={() => handleDelete(exp)}
              disabled={deleteMut.isPending}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DailyClosePage({ dailyCloseDate }) {
  const [modal, setModal] = useState(null); // 'expense' | 'drawer' | null
  const [editing, setEditing] = useState(null); // expense being edited

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Daily close</h1>
          <p className="text-sm text-gray-500">Did the drawer balance, and was the day worth it?</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setModal("drawer")}>
            Drawer adjustment
          </Button>
          <Button onClick={() => setModal("expense")}>Record expense</Button>
        </div>
      </header>

      <DailyClose initialDate={dailyCloseDate} />

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Expenses</h2>
        <ExpensesList onEdit={(exp) => setEditing(exp)} />
      </section>

      {modal === "expense" && <ExpenseForm onClose={() => setModal(null)} />}
      {modal === "drawer" && <DrawerAdjustmentForm onClose={() => setModal(null)} />}
      {editing && <ExpenseForm expense={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
