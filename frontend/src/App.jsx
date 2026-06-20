import InventoryPage from "./pages/InventoryPage";

function App() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <span className="text-sm font-semibold text-indigo-600">SparkPOS</span>
        </div>
      </div>
      <InventoryPage />
    </div>
  );
}

export default App;
