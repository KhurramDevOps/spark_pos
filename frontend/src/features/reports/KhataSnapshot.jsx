import { formatPaisa } from "../../lib/format";

function List({ title, rows, onClick }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-fg-subtle">None.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id}>
              <button onClick={onClick} className="flex w-full items-baseline justify-between py-1.5 text-sm hover:text-accent">
                <span>{r.name}</span>
                <span className="tabular-nums">{formatPaisa(r.balance)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Top-10 khata balances (spec 006 §4.6). Positive = they owe you; negative =
 *  store credit / you owe. Rows link to the existing Customers/Suppliers screens. */
export default function KhataSnapshot({ khata, onNavigate }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-fg">Khata snapshot</h2>
      <div className="grid gap-5 sm:grid-cols-2">
        <List title="Customers owe you" rows={khata.customers.owed} onClick={() => onNavigate?.("customers")} />
        <List title="Customer store credit (you owe)" rows={khata.customers.credit} onClick={() => onNavigate?.("customers")} />
        <List title="You owe suppliers" rows={khata.suppliers.owed} onClick={() => onNavigate?.("suppliers")} />
        <List title="Supplier advances (they owe you)" rows={khata.suppliers.credit} onClick={() => onNavigate?.("suppliers")} />
      </div>
    </div>
  );
}
