import { useState } from "react";
import { useTheme, toggleTheme } from "./lib/useTheme";
import { useAuth } from "./features/auth/useAuth";
import LoginPage from "./features/auth/LoginPage";
import BootstrapPage from "./features/auth/BootstrapPage";
import ProfilePage from "./features/auth/ProfilePage";
import UsersPage from "./features/auth/UsersPage";
import { Badge } from "./components/ui";
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
// from workers is purely so they don't bump into 403s — workers get the POS, the
// (read-only) inventory, customers (payments/returns) and their own sales history.
const TABS = [
  { id: "sales", label: "Sales" },
  { id: "saleHistory", label: "Sales History" },
  { id: "customers", label: "Customers" },
  { id: "inventory", label: "Inventory" },
  { id: "negativeStock", label: "Negative Stock", ownerOnly: true },
  { id: "purchases", label: "Purchases", ownerOnly: true },
  { id: "suppliers", label: "Suppliers", ownerOnly: true },
  { id: "dailyClose", label: "Daily Close", ownerOnly: true },
  { id: "reports", label: "Reports", ownerOnly: true },
  { id: "users", label: "Users", ownerOnly: true },
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

/** Sun/moon theme toggle — one click, instant, persists (see lib/useTheme). */
function ThemeToggle() {
  const theme = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="rounded-md p-2 text-fg-muted transition hover:bg-muted hover:text-fg"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {isDark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

function AuthedApp() {
  const { user, isOwner, logout } = useAuth();
  const [tab, setTab] = useState("sales");
  // Payload carried across a programmatic navigation (e.g. Reports → a specific
  // Daily Close date). Cleared on any manual tab click.
  const [dailyCloseDate, setDailyCloseDate] = useState(null);

  const navigate = (tabId, payload = null) => {
    setTab(tabId);
    setDailyCloseDate(tabId === "dailyClose" ? payload : null);
  };

  const visibleTabs = TABS.filter((t) => isOwner || !t.ownerOnly);
  // Defensive UX only — the server is the real guard. Never render an owner-only
  // page to a worker even if `tab` somehow points at one.
  const isAllowed = tab === "profile" || visibleTabs.some((t) => t.id === tab);
  const Page = (isAllowed ? PAGES[tab] : PAGES.sales) ?? InventoryPage;

  return (
    <div className="min-h-screen">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4">
          <span className="py-3 text-sm font-semibold text-accent">SparkPOS</span>
          <nav className="flex gap-1">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => navigate(t.id)}
                className={`border-b-2 px-3 py-3 text-sm font-medium transition ${
                  tab === t.id
                    ? "border-accent text-accent"
                    : "border-transparent text-fg-muted hover:text-fg"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => navigate("profile")}
              className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm transition hover:bg-muted ${
                tab === "profile" ? "text-accent" : "text-fg-muted hover:text-fg"
              }`}
              title="Your account"
            >
              <span className="font-medium">{user.username}</span>
              <Badge tone={isOwner ? "green" : "gray"}>{user.role}</Badge>
            </button>
            <button
              onClick={logout}
              className="rounded-md px-2 py-1 text-sm font-medium text-fg-muted transition hover:bg-muted hover:text-fg"
            >
              Log out
            </button>
            <ThemeToggle />
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
