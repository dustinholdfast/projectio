import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Native `<select>`, styled to match Input.
 *
 * Deliberately native rather than a custom listbox: the browser gives keyboard
 * behaviour, screen-reader semantics, and sensible mobile pickers for free, and
 * none of the fields here need multi-select, search, or rich option rendering.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        "h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
