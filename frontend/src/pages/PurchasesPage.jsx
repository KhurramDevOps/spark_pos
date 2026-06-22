import { useState } from "react";
import { Button } from "../components/ui";
import PurchaseForm from "../features/purchases/PurchaseForm";
import PurchaseHistory from "../features/purchases/PurchaseHistory";

export default function PurchasesPage() {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Purchases</h1>
          <p className="text-sm text-gray-500">Record stock coming in — updates stock and average cost.</p>
        </div>
        <Button onClick={() => setShowForm(true)}>+ New purchase</Button>
      </header>

      <PurchaseHistory />

      {showForm && <PurchaseForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
