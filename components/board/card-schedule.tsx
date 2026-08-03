"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { setCardDueDate, setCardPaused } from "@/lib/actions/board";
import { dayKeyOfDueDate } from "@/lib/due-status";

/**
 * Per-card scheduling controls: a due date, and a pause toggle.
 *
 * These are the only way to *choose* a card's lane. Dragging between lanes is a
 * shortcut over the same two fields (see lib/due-status.ts), which is why there
 * is no "mark overdue" control here either — a card becomes overdue by its date
 * passing, not by anyone saying so.
 *
 * Pointer events are stopped from bubbling: the card above this is a drag handle,
 * and without that a click on the date picker starts a drag instead of opening it.
 */
export function CardSchedule({
  cardId,
  dueDate,
  paused,
}: {
  cardId: string;
  dueDate: Date | null;
  paused: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const value = dueDate ? dayKeyOfDueDate(dueDate) : "";

  function run(action: () => Promise<{ error: string } | undefined>) {
    startTransition(async () => {
      // The action revalidates on success, which re-renders this card with the
      // new value. On failure nothing changed server-side, so refresh to drop
      // whatever the control is showing and fall back to the stored value —
      // these controls have nowhere to render an inline error.
      const result = await action();
      if (result?.error) router.refresh();
    });
  }

  return (
    <div
      className="flex items-center gap-2"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <label className="sr-only" htmlFor={`due-${cardId}`}>
        Due date
      </label>
      <input
        id={`due-${cardId}`}
        type="date"
        value={value}
        disabled={isPending}
        onChange={(event) =>
          run(() => setCardDueDate({ cardId, dueDate: event.target.value }))
        }
        className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="button"
        disabled={isPending}
        aria-pressed={paused}
        onClick={() => run(() => setCardPaused({ cardId, paused: !paused }))}
        className="h-7 rounded-md border border-border px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {paused ? "Resume" : "Pause"}
      </button>
    </div>
  );
}
