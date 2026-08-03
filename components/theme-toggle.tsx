"use client";

import * as React from "react";
import { Button } from "@/components/ui";

/**
 * Minimal light/dark switch used by the design preview. It toggles the `.dark`
 * class on <html>, which is the hook the token system keys off. A production
 * theme provider (persisted preference) can replace this later; the token
 * contract stays the same.
 */
export function ThemeToggle() {
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
  }

  return (
    <Button variant="outline" size="sm" onClick={toggle} aria-pressed={dark}>
      {dark ? "☀ Light" : "☾ Dark"}
    </Button>
  );
}
