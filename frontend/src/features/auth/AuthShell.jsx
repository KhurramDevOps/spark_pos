/** Centered single-card layout for the logged-out screens (login + bootstrap). */
export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold text-accent">SparkPOS</div>
          {subtitle && <div className="mt-1 text-sm text-fg-muted">{subtitle}</div>}
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
          <h1 className="mb-4 text-base font-semibold text-fg">{title}</h1>
          {children}
        </div>
        {footer && <div className="mt-4 text-center text-xs text-fg-subtle">{footer}</div>}
      </div>
    </div>
  );
}
