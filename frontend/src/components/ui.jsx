// Minimal Tailwind UI primitives. (shadcn/ui can layer in later; kept lean for now.)
import { useState } from "react";

export function Button({ variant = "primary", className = "", ...props }) {
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "bg-surface text-fg-muted border border-line hover:bg-muted",
    danger: "bg-surface text-red-600 border border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/40",
    ghost: "bg-transparent text-fg-muted hover:bg-muted",
  };
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, error, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-fg-muted">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-fg-subtle">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-line px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-muted";

export function TextInput(props) {
  return <input className={inputClass} {...props} />;
}

/**
 * Password input with an independent show/hide toggle. Always starts masked; each
 * instance owns its own `visible` state, so toggling one field never reveals
 * another on the same form. The toggle is a type="button" (it never submits the
 * form), and the caller's autoComplete (current-password / new-password) and other
 * props pass straight through, so password-manager UI keeps working.
 */
export function PasswordInput({ className = "", ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={`${inputClass} pr-10 ${className}`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-fg-subtle transition hover:text-fg-muted"
      >
        {visible ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
            <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
            <line x1="2" x2="22" y1="2" y2="22" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

export function Select({ children, ...props }) {
  return (
    <select className={inputClass} {...props}>
      {children}
    </select>
  );
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onMouseDown={onClose}
    >
      <div
        className="mt-8 w-full max-w-lg rounded-lg border border-line bg-surface shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          <button onClick={onClose} className="text-fg-subtle hover:text-fg-muted" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

export function Badge({ tone = "gray", children }) {
  const tones = {
    gray: "bg-muted text-fg-muted",
    red: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    green: "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300">{children}</div>;
}
