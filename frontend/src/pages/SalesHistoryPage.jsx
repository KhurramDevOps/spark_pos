import SaleHistory from "../features/sales/SaleHistory";

export default function SalesHistoryPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Sales history</h1>
        <p className="text-sm text-gray-500">Past sales with profit. Click a sale for its per-line detail.</p>
      </header>

      <SaleHistory />
    </div>
  );
}
