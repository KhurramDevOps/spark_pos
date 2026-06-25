import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { formatPaisa } from "../../lib/format";
import { useTheme } from "../../lib/useTheme";

const LABELS = { salary: "Salary", electricity: "Electricity", other: "Other" };

// Recharts paints SVG fill/stroke from props, not CSS — Tailwind `dark:` can't
// reach it, so the chart reads the active theme and passes hex directly.
function chartColors(dark) {
  return {
    axis: dark ? "#9aa4b2" : "#6b7280", // tick label text
    axisLine: dark ? "#30363d" : "#e5e7eb", // axis + tick lines
    bar: dark ? "#818cf8" : "#6366f1", // indigo-400 dark / indigo-500 light
    cursor: dark ? "#ffffff14" : "#00000010", // hover band
    tooltipBg: dark ? "#161b22" : "#ffffff",
    tooltipBorder: dark ? "#30363d" : "#e5e7eb",
    tooltipText: dark ? "#e6edf3" : "#111827",
  };
}

/** Expense breakdown by category (spec 006 §4.5). Horizontal bars + totals; the
 *  sum equals the headline Expenses tile (same source aggregation). */
export default function ExpenseBreakdown({ breakdown }) {
  const c = chartColors(useTheme() === "dark");
  if (!breakdown?.length) return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="mb-2 text-sm font-semibold text-fg">Expense breakdown</h2>
      <p className="text-sm text-fg-muted">No expenses in this window.</p>
    </div>
  );

  const data = breakdown.map((b) => ({ category: LABELS[b.category] ?? b.category, rupees: Number(b.total) / 100, paisa: b.total }));

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="mb-2 text-sm font-semibold text-fg">Expense breakdown</h2>
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 52)}>
        <BarChart layout="vertical" data={data} margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
          <XAxis type="number" tick={{ fontSize: 11, fill: c.axis }} stroke={c.axisLine} />
          <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: c.axis }} stroke={c.axisLine} width={84} />
          <Tooltip
            formatter={(_v, _n, p) => formatPaisa(p.payload.paisa)}
            cursor={{ fill: c.cursor }}
            contentStyle={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, color: c.tooltipText }}
            labelStyle={{ color: c.tooltipText }}
            itemStyle={{ color: c.tooltipText }}
          />
          <Bar dataKey="rupees" fill={c.bar} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <ul className="mt-2 space-y-1 text-sm">
        {data.map((d) => (
          <li key={d.category} className="flex justify-between">
            <span className="text-fg-muted">{d.category}</span>
            <span className="tabular-nums text-fg">{formatPaisa(d.paisa)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
