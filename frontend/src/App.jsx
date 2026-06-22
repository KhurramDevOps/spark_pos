import { useState } from "react";
import InventoryPage from "./pages/InventoryPage";
import PurchasesPage from "./pages/PurchasesPage";

const TABS = [
  { id: "inventory", label: "Inventory" },
  { id: "purchases", label: "Purchases" },
];

function App() {
  const [tab, setTab] = useState("inventory");

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
      {tab === "inventory" ? <InventoryPage /> : <PurchasesPage />}
    </div>
  );
}

export default App;
