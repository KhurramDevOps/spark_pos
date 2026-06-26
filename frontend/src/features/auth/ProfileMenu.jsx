import { Badge } from "../../components/ui";
import Dropdown, { MenuItem } from "../../components/Dropdown";
import { useTheme, toggleTheme } from "../../lib/useTheme";
import { useAuth } from "./useAuth";

/** Up to two letters from the username for the avatar (e.g. "ali_raza" → "AR"). */
function initials(username) {
  if (!username) return "?";
  const parts = username.split(/[\s._-]+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : username.slice(0, 2);
  return chars.toUpperCase();
}

/**
 * The account/identity control for the app bar: an initials avatar that opens a
 * menu (signed-in identity, account, owner-only Users, theme, log out). Role-based
 * visibility uses the same isOwner flag as the nav — workers never see Users.
 */
export default function ProfileMenu({ onNavigate, activeTab }) {
  const { user, isOwner, logout } = useAuth();
  const theme = useTheme();
  const isDark = theme === "dark";

  return (
    <Dropdown
      align="right"
      panelClassName="min-w-56"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label="Account menu"
          title={user.username}
          className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition ${
            activeTab === "profile" || open
              ? "border-accent bg-indigo-50 text-accent dark:bg-indigo-950/40"
              : "border-line bg-muted text-fg-muted hover:text-fg"
          }`}
        >
          {initials(user.username)}
        </button>
      )}
    >
      {({ close }) => (
        <>
          <div className="px-3.5 py-2.5">
            <div className="text-xs text-fg-subtle">Signed in as</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="truncate text-sm font-medium text-fg">{user.username}</span>
              <Badge tone={isOwner ? "green" : "gray"}>{user.role}</Badge>
            </div>
          </div>

          <div className="border-t border-line py-1">
            <MenuItem onClick={() => { onNavigate("profile"); close(); }}>Your account</MenuItem>
            {isOwner && <MenuItem onClick={() => { onNavigate("users"); close(); }}>Users</MenuItem>}
            {/* Theme stays open so the change is visible and re-toggleable. */}
            <MenuItem onClick={toggleTheme}>
              {isDark ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
              {isDark ? "Switch to light" : "Switch to dark"}
            </MenuItem>
          </div>

          <div className="border-t border-line py-1">
            <MenuItem
              onClick={() => { close(); logout(); }}
              className="text-red-600 hover:text-red-700 dark:text-red-400"
            >
              Log out
            </MenuItem>
          </div>
        </>
      )}
    </Dropdown>
  );
}
