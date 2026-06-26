import Dropdown, { MenuItem } from "./Dropdown";

/**
 * A labeled nav dropdown grouping lower-frequency destinations (e.g. Purchasing,
 * Insights). `items` are already role-filtered by the caller; if none remain the
 * group renders nothing — so a worker never sees an empty owner-only group.
 */
export default function NavGroup({ label, items, activeId, onSelect }) {
  if (items.length === 0) return null;
  const groupActive = items.some((i) => i.id === activeId);

  return (
    <Dropdown
      panelClassName="min-w-44"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className={`flex items-center gap-1 border-b-2 px-3 py-3 text-sm font-medium transition ${
            groupActive ? "border-accent text-accent" : "border-transparent text-fg-muted hover:text-fg"
          }`}
        >
          {label}
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    >
      {({ close }) =>
        items.map((it) => (
          <MenuItem
            key={it.id}
            onClick={() => { onSelect(it.id); close(); }}
            className={activeId === it.id ? "text-accent" : ""}
          >
            {it.label}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}
