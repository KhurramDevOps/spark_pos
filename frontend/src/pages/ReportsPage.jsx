import { useState } from "react";
import { ErrorText } from "../components/ui";
import { useReport } from "../features/reports/hooks";
import WindowPicker from "../features/reports/WindowPicker";
import HeadlineTiles from "../features/reports/HeadlineTiles";
import TrendChart from "../features/reports/TrendChart";
import ItemPerformance from "../features/reports/ItemPerformance";
import ExpenseBreakdown from "../features/reports/ExpenseBreakdown";
import KhataSnapshot from "../features/reports/KhataSnapshot";

/** Reports screen (spec 006). One round-trip per window via useReport. onNavigate
 *  is supplied by App for trend day-click → Daily Close and khata → ledger links. */
export default function ReportsPage({ onNavigate }) {
  const [params, setParams] = useState({ window: "this_month" });
  const { data, isLoading, isError, error, isFetching } = useReport(params);

  const needsDates = params.window === "custom" && !(params.start && params.end);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500">How the shop is doing, and what's driving it. Read-only.</p>
      </header>

      <div className="mb-5">
        <WindowPicker value={params} onChange={setParams} />
      </div>

      {needsDates && <p className="text-sm text-gray-500">Pick a start and end date for the custom range.</p>}
      {isError && <ErrorText>{error.message}</ErrorText>}
      {!needsDates && isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {data && !needsDates && (
        <div className={`space-y-5 ${isFetching ? "opacity-60 transition-opacity" : ""}`}>
          <HeadlineTiles headline={data.headline} />
          <TrendChart trend={data.trend} onDayClick={(date) => onNavigate?.("dailyClose", date)} />
          <ItemPerformance items={data.items} deadStock={data.deadStock} />
          <div className="grid gap-5 lg:grid-cols-2">
            <ExpenseBreakdown breakdown={data.expenseBreakdown} />
            <KhataSnapshot khata={data.khata} onNavigate={onNavigate} />
          </div>
        </div>
      )}
    </div>
  );
}
