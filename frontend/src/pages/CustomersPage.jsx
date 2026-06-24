import CustomersList from "../features/customers/CustomersList";

export default function CustomersPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-fg">Customers</h1>
        <p className="text-sm text-fg-muted">
          Who you sell to and their khata (udhaar). Record payments to settle credit.
        </p>
      </header>

      <CustomersList />
    </div>
  );
}
