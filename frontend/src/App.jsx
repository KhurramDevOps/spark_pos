import { useState } from "react";
import { useAuth } from "./features/auth/useAuth";
import LoginPage from "./features/auth/LoginPage";
import BootstrapPage from "./features/auth/BootstrapPage";
import ProfilePage from "./features/auth/ProfilePage";
import UsersPage from "./features/auth/UsersPage";
import ProfileMenu from "./features/auth/ProfileMenu";
import NavGroup from "./components/NavGroup";
import InventoryPage from "./pages/InventoryPage";
import PurchasesPage from "./pages/PurchasesPage";
import SuppliersPage from "./pages/SuppliersPage";
import SalesPage from "./pages/SalesPage";
import SalesHistoryPage from "./pages/SalesHistoryPage";
import CustomersPage from "./pages/CustomersPage";
import NegativeStockPage from "./pages/NegativeStockPage";
import DailyClosePage from "./pages/DailyClosePage";
import ReportsPage from "./pages/ReportsPage";

// `ownerOnly` mirrors the slice-7 server guards (the real boundary). Hiding these
// from workers is purely so they don't bump into 403s. The bar shows daily-use
// items inline; lower-frequency owner items live in labeled groups; admin (Users)
// and identity live in the profile menu (top-right).
const INLINE_TABS = [
  { id: "sales", label: "Sales" },
  { id: "saleHistory", label: "Sales History" },
  { id: "customers", label: "Customers" },
  { id: "inventory", label: "Inventory" },
  { id: "dailyClose", label: "Daily Close", ownerOnly: true },
];

// Periodic owner destinations, grouped by what they're about: "Purchasing" is the
// buy-side workflow (you purchase from suppliers); "Insights" is read-only review.
const GROUPS = [
  {
    label: "Purchasing",
    items: [
      { id: "purchases", label: "Purchases", ownerOnly: true },
      { id: "suppliers", label: "Suppliers", ownerOnly: true },
    ],
  },
  {
    label: "Insights",
    items: [
      { id: "reports", label: "Reports", ownerOnly: true },
      { id: "negativeStock", label: "Negative Stock", ownerOnly: true },
    ],
  },
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
  reports: ReportsPage,
  users: UsersPage,
  profile: ProfilePage,
};

function AuthedApp() {
  const { isOwner } = useAuth();
  const [tab, setTab] = useState("sales");
  // Payload carried across a programmatic navigation (e.g. Reports → a specific
  // Daily Close date). Cleared on any manual tab click.
  const [dailyCloseDate, setDailyCloseDate] = useState(null);

  const navigate = (tabId, payload = null) => {
    setTab(tabId);
    setDailyCloseDate(tabId === "dailyClose" ? payload : null);
  };

  // The same isOwner filter as before, now applied to inline tabs AND groups.
  const visibleInline = INLINE_TABS.filter((t) => isOwner || !t.ownerOnly);
  const visibleGroups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => isOwner || !i.ownerOnly),
  })).filter((g) => g.items.length > 0);

  // Defensive UX only — the server is the real guard. Never render a destination a
  // worker can't reach even if `tab` somehow points at one. Users/profile are
  // reachable from the menu (not the bar), so allow them explicitly.
  const reachable = new Set([
    ...visibleInline.map((t) => t.id),
    ...visibleGroups.flatMap((g) => g.items.map((i) => i.id)),
    "profile",
    ...(isOwner ? ["users"] : []),
  ]);
  const Page = (reachable.has(tab) ? PAGES[tab] : PAGES.sales) ?? InventoryPage;

  const tabClass = (active) =>
    `border-b-2 px-3 py-3 text-sm font-medium transition ${
      active ? "border-accent text-accent" : "border-transparent text-fg-muted hover:text-fg"
    }`;

  return (
    <div className="min-h-screen">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-4">
          <span className="mr-4 py-3 text-sm font-semibold text-accent">SparkPOS</span>
          <nav className="flex items-center gap-1">
            {visibleInline.map((t) => (
              <button key={t.id} onClick={() => navigate(t.id)} className={tabClass(tab === t.id)}>
                {t.label}
              </button>
            ))}
            {visibleGroups.map((g) => (
              <NavGroup key={g.label} label={g.label} items={g.items} activeId={tab} onSelect={navigate} />
            ))}
          </nav>
          <div className="ml-auto">
            <ProfileMenu onNavigate={navigate} activeTab={tab} />
          </div>
        </div>
      </div>
      <Page onNavigate={navigate} dailyCloseDate={dailyCloseDate} />
    </div>
  );
}

export default function App() {
  const { status, user } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-fg-muted">
        Loading…
      </div>
    );
  }
  if (status === "needsBootstrap") return <BootstrapPage />;
  if (!user) return <LoginPage />;
  return <AuthedApp />;
}
