import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { formatPaisa } from "../../lib/format";

const toRupees = (paisa) => Number(paisa) / 100;

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded border border-line bg-surface px-3 py-2 text-xs shadow">
      <p className="mb-1 font-medium text-fg">{label}</p>
      <p className="text-accent">Profit: {formatPaisa(d.profit)}</p>
      <p className="text-fg-muted">Revenue: {formatPaisa(d.revenue)}</p>
      <p className="text-fg-muted">Expenses: {formatPaisa(d.expenses)}</p>
    </div>
  );
}

/** Profit-per-day line (spec 006 §4.3, §9.1 resolved → profit-only). Clicking a
 *  day calls onDayClick(YYYY-MM-DD) → the page opens that day's Daily Close. */
export default function TrendChart({ trend, onDayClick }) {
  if (!trend?.length) return <p className="text-sm text-fg-muted">No data in this window.</p>;
  const data = trend.map((d) => ({ ...d, profitR: toRupees(d.profit) }));
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="mb-2 text-sm font-semibold text-fg">Profit per day</h2>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart
          data={data}
          onClick={(e) => e?.activeLabel && onDayClick?.(e.activeLabel)}
          margin={{ top: 5, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={52} />
          <Tooltip content={<ChartTooltip />} />
          <Line type="monotone" dataKey="profitR" name="Profit" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-xs text-fg-subtle">Click a day to open its Daily Close.</p>
    </div>
  );
}
