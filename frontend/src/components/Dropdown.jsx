import { useState, useRef, useEffect } from "react";

/**
 * A small headless dropdown for the app chrome (nav groups + profile menu).
 * Opens on trigger click; closes on outside click and Escape. Panel is absolutely
 * positioned under the trigger.
 *
 * @param {(o: { open: boolean, toggle: () => void, close: () => void }) => JSX.Element} trigger
 * @param {"left"|"right"} [align]   which edge the panel aligns to
 * @param {React.ReactNode | ((o:{ close: () => void }) => React.ReactNode)} children  panel contents
 */
export default function Dropdown({ trigger, align = "left", panelClassName = "", children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v), close })}
      {open && (
        <div
          role="menu"
          className={`absolute z-50 mt-1 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          } ${panelClassName}`}
        >
          {typeof children === "function" ? children({ close }) : children}
        </div>
      )}
    </div>
  );
}

/** Full-width, touch-comfortable (~44px) row for use inside a Dropdown panel. */
export function MenuItem({ children, onClick, className = "" }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3.5 py-3 text-left text-sm text-fg-muted transition hover:bg-muted hover:text-fg ${className}`}
    >
      {children}
    </button>
  );
}
