/**
 * A row of labeled headline numbers (e.g. the Customers/Suppliers khata totals).
 * `tiles`: [{ label, value, className? }]. Presentation-only.
 */
export default function StatTiles({ tiles }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-line bg-surface px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-fg-muted">{t.label}</div>
          <div className={`mt-1 text-lg font-semibold tabular-nums ${t.className ?? "text-fg"}`}>
            {t.value}
          </div>
        </div>
      ))}
    </div>
  );
}
