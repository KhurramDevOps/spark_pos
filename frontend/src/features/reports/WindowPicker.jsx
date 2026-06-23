import { TextInput } from "../../components/ui";

const PRESETS = [
  { id: "today", label: "Today" },
  { id: "this_week", label: "This week" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "custom", label: "Custom" },
];

const today = () => new Date().toLocaleDateString("en-CA");

/** Segmented window selector (spec 006 §4.1). value = { window, start?, end? }. */
export default function WindowPicker({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => set({ window: p.id })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              value.window === p.id ? "bg-indigo-600 text-white" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.window === "custom" && (
        <div className="flex items-end gap-2">
          <label className="text-xs text-gray-500">
            From
            <TextInput type="date" max={today()} value={value.start ?? ""} onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label className="text-xs text-gray-500">
            To
            <TextInput type="date" max={today()} value={value.end ?? ""} onChange={(e) => set({ end: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}
