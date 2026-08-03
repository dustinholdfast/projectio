"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Modal dialog built on the native `<dialog>` element.
 *
 * Native rather than a div-with-a-backdrop, because `showModal()` supplies the
 * things hand-rolled modals routinely get wrong: a focus trap, inertness of the
 * page behind, Escape to close, and correct semantics for screen readers. What
 * is left to do here is small — keep the element in step with the `open` prop,
 * and report closes back up.
 */
export function Dialog({
  open,
  onClose,
  labelledBy,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** id of the element naming the dialog, for `aria-labelledby`. */
  labelledBy?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // showModal() throws if already open, and close() on a closed dialog is a
    // no-op — so both are guarded rather than called blindly.
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      // Escape fires `cancel`, and the browser closes the dialog itself; the
      // parent's state has to follow or it would think the dialog is still open.
      onCancel={onClose}
      onClose={onClose}
      // A click landing on the dialog element itself is a click on the backdrop:
      // the content sits in a child, so anything inside stops here first.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[min(48rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-foreground shadow-lg",
        "backdrop:bg-black/50 backdrop:backdrop-blur-sm",
        className,
      )}
    >
      {/* Rendered only while open so the form inside remounts each time, picking
          up fresh values rather than showing a stale edit from last time. */}
      {open ? <div className="max-h-[85vh] overflow-y-auto">{children}</div> : null}
    </dialog>
  );
}
