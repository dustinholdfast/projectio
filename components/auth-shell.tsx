import * as React from "react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Brand lockup shown above the auth panel — an indigo Kanban glyph plus the
 * product wordmark. Links home so the mark doubles as a way out of the flow.
 */
function BrandMark() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
        {/* three columns — the board, in miniature */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="size-4"
        >
          <rect x="3" y="4" width="5" height="16" rx="1.5" fill="currentColor" />
          <rect x="9.5" y="4" width="5" height="10" rx="1.5" fill="currentColor" />
          <rect x="16" y="4" width="5" height="13" rx="1.5" fill="currentColor" />
        </svg>
      </span>
      <span className="text-base font-semibold tracking-tight">TestProject</span>
    </Link>
  );
}

/**
 * Shared "Calm Focus" chrome for the auth screens: a quiet, centered layout
 * with the brand lockup, an elevated card panel, and a manual theme toggle.
 * Screens supply only their copy, form, and footer link — presentation lives
 * here so login and signup stay visually identical.
 */
export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-12">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <BrandMark />

      <Card className="w-full max-w-sm shadow-md">
        <CardHeader className="gap-2 p-6 pb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </span>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 p-6 pt-0">
          {children}
          <div className="border-t border-border pt-4">{footer}</div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Local-only workspace — your data stays on this machine.
      </p>
    </main>
  );
}
