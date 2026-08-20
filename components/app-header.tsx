import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOutAction } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

/**
 * Chrome shared by the signed-in screens: the wordmark (now the way back to
 * Focus), a Focus / Boards switch, the screen's own title, an optional slot
 * for screen-specific controls, and the theme/sign-out cluster.
 *
 * Kept in one place so the pane, the list and a board read as the same
 * application rather than three screens that happen to look similar.
 */
export function AppHeader({
  title,
  subtitle,
  actions,
  active,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  active?: "focus" | "boards" | "board";
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex min-w-0 flex-col">
          <Link
            href="/"
            className="w-fit rounded text-xs font-semibold uppercase tracking-wider text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Project/IO
          </Link>
          <h1 className="truncate text-base font-semibold tracking-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <nav
          aria-label="Primary"
          className="flex items-center gap-1 rounded-md border border-border p-0.5"
        >
          <NavLink href="/" current={active === "focus"}>
            Focus
          </NavLink>
          <NavLink href="/boards" current={active === "boards"}>
            Boards
          </NavLink>
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <ThemeToggle />
        <form action={signOutAction}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "rounded px-2.5 py-1 text-xs font-medium",
        current
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
