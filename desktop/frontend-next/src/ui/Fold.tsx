import { useEffect, useState, type ReactNode } from "react";

// A little over --t-card: the fallback for a close that never reports a
// transition (reduced motion, or a row grid the browser cannot interpolate).
const SETTLE_MS = 220;

/** A row set that folds to nothing and leaves the DOM once closed. The wrapper
 *  is always rendered, so mounting the tree never plays the fold; only a change
 *  of `open` does. */
export function Fold({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const show = open || mounted;
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);
  return (
    <div className="foldgrid" data-open={open ? "" : undefined} inert={!open || undefined} aria-hidden={!open || undefined}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && !open && e.propertyName === "grid-template-rows") setMounted(false);
      }}>
      {show && <div className={className ? `foldgrid-in ${className}` : "foldgrid-in"}>{children}</div>}
    </div>
  );
}
