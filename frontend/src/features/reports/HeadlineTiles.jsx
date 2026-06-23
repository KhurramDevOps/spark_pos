import { formatPaisa } from "../../lib/format";

/** "vs prior" delta (spec 006 §4.2). Green up / red down / grey when the prior
 *  window had no data (priorZero → pct null, no division by zero). */
function Delta({ delta }) {
  if (!delta || delta.priorZero || delta.pct == null) {
    return <span className="text-xs text-gray-400">no prior-window data</span>;
  }
  const abs = Number(delta.abs);
  const color = abs === 0 ? "text-gray-400" : abs > 0 ? "text-green-600" : "text-red-600";
  const sign = abs > 0 ? "+" : ""; // a negative pct already carries its own "−"
  return (
    <span className={`text-xs font-medium ${color}`} title={`${formatPaisa(delta.abs)} vs prior`}>
      {sign}{delta.pct}% vs prior
    </span>
  );
}

const TILES = [
  { key: "revenue", label: "Revenue" },
  { key: "grossProfit", label: "Gross profit" },
  { key: "expenses", label: "Expenses" },
  { key: "net", label: "Net" },
];

export default function HeadlineTiles({ headline }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {TILES.map((t) => (
        <div key={t.key} className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t.label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{formatPaisa(headline[t.key].value)}</p>
          <div className="mt-1">
            <Delta delta={headline[t.key].delta} />
          </div>
        </div>
      ))}
    </div>
  );
}
