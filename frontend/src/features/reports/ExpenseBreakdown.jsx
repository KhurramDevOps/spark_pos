import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { formatPaisa } from "../../lib/format";

const LABELS = { salary: "Salary", electricity: "Electricity", other: "Other" };

/** Expense breakdown by category (spec 006 §4.5). Horizontal bars + totals; the
 *  sum equals the headline Expenses tile (same source aggregation). */
export default function ExpenseBreakdown({ breakdown }) {
  if (!breakdown?.length) return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-900">Expense breakdown</h2>
      <p className="text-sm text-gray-500">No expenses in this window.</p>
    </div>
  );

  const data = breakdown.map((b) => ({ category: LABELS[b.category] ?? b.category, rupees: Number(b.total) / 100, paisa: b.total }));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-900">Expense breakdown</h2>
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 52)}>
        <BarChart layout="vertical" data={data} margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={84} />
          <Tooltip formatter={(_v, _n, p) => formatPaisa(p.payload.paisa)} />
          <Bar dataKey="rupees" fill="#6366f1" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <ul className="mt-2 space-y-1 text-sm">
        {data.map((d) => (
          <li key={d.category} className="flex justify-between">
            <span className="text-gray-600">{d.category}</span>
            <span className="tabular-nums text-gray-900">{formatPaisa(d.paisa)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
