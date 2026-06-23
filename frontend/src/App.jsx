import { useState } from "react";
import InventoryPage from "./pages/InventoryPage";
import PurchasesPage from "./pages/PurchasesPage";
import SuppliersPage from "./pages/SuppliersPage";
import SalesPage from "./pages/SalesPage";
import SalesHistoryPage from "./pages/SalesHistoryPage";
import CustomersPage from "./pages/CustomersPage";
import NegativeStockPage from "./pages/NegativeStockPage";
import DailyClosePage from "./pages/DailyClosePage";

const TABS = [
  { id: "sales", label: "Sales" },
  { id: "saleHistory", label: "Sales History" },
  { id: "customers", label: "Customers" },
  { id: "inventory", label: "Inventory" },
  { id: "negativeStock", label: "Negative Stock" },
  { id: "purchases", label: "Purchases" },
  { id: "suppliers", label: "Suppliers" },
  { id: "dailyClose", label: "Daily Close" },
];

const PAGES = {
  sales: SalesPage,
  saleHistory: SalesHistoryPage,
  customers: CustomersPage,
  inventory: InventoryPage,
  negativeStock: NegativeStockPage,
  purchases: PurchasesPage,
  suppliers: SuppliersPage,
  dailyClose: DailyClosePage,
};

function App() {
  const [tab, setTab] = useState("sales");

  return (
    <div className="min-h-screen">
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4">
          <span className="py-3 text-sm font-semibold text-indigo-600">SparkPOS</span>
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`border-b-2 px-3 py-3 text-sm font-medium transition ${
                  tab === t.id
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
      {(() => {
        const Page = PAGES[tab] ?? InventoryPage;
        return <Page />;
      })()}
    </div>
  );
}

export default App;
