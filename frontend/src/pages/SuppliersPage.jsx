import SuppliersList from "../features/purchases/SuppliersList";

export default function SuppliersPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-fg">Suppliers</h1>
        <p className="text-sm text-fg-muted">
          Who you buy from and what you owe them. Record payments to settle credit.
        </p>
      </header>

      <SuppliersList />
    </div>
  );
}
