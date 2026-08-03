// Derived scheduling status for a card: Overdue / Due Now / Later / Paused.
//
// Pure and framework-free so the rules are testable in isolation (see
// test/due-status.test.ts) and identical everywhere they are applied — the
// board grouping, the card badge, and the drag-to-lane action all read from
// here rather than re-deriving the comparison.

export type DueStatus = "overdue" | "dueNow" | "later" | "paused";

/** Left-to-right lane order: most urgent first, parked work last. */
export const DUE_STATUS_ORDER: readonly DueStatus[] = [
  "overdue",
  "dueNow",
  "later",
  "paused",
] as const;

export const DUE_STATUS_LABEL: Record<DueStatus, string> = {
  overdue: "Overdue",
  dueNow: "Due Now",
  later: "Later",
  paused: "Paused",
};

/**
 * A card can be dragged *out* of Overdue but never *into* it: being late is
 * something time does to a card, not a state anyone chooses. The lane is a valid
 * drag source and an invalid drop target.
 */
export const DUE_STATUS_DROPPABLE: Record<DueStatus, boolean> = {
  overdue: false,
  dueNow: true,
  later: true,
  paused: true,
};

/** The fields the derivation needs — kept structural so tests need no Prisma. */
export type SchedulableCard = {
  dueDate: Date | null;
  pausedAt: Date | null;
};

/**
 * Calendar day of a date-only value, as `YYYY-MM-DD`.
 *
 * `@db.Date` columns come back as midnight **UTC**, so the intended day is in
 * the UTC components. Reading local components here would shift the day for
 * anyone behind UTC.
 */
export function dayKeyOfDueDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Calendar day of an instant in the *server's* timezone, as `YYYY-MM-DD`.
 *
 * Used for "today". This is the one place the feature is timezone-sensitive: a
 * user in a different zone than the server sees the Overdue boundary move at the
 * server's midnight, not their own. Fixing it properly means storing a timezone
 * per user; until then, set `TZ` on the host to the audience's zone.
 */
export function dayKeyOfInstant(instant: Date): string {
  const year = instant.getFullYear();
  const month = String(instant.getMonth() + 1).padStart(2, "0");
  const day = String(instant.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Which lane a card belongs in.
 *
 * Paused takes precedence over everything: a parked card is not "overdue", it is
 * deliberately not being worked on. An unscheduled card (no due date) is Later —
 * it is not late, and it is not due today.
 */
export function dueStatusOf(card: SchedulableCard, now: Date): DueStatus {
  if (card.pausedAt) return "paused";
  if (!card.dueDate) return "later";

  const due = dayKeyOfDueDate(card.dueDate);
  const today = dayKeyOfInstant(now);

  // Both are YYYY-MM-DD, so lexicographic order is chronological order.
  if (due < today) return "overdue";
  if (due === today) return "dueNow";
  return "later";
}

/**
 * The `dueDate` / `pausedAt` a card must take to land in `status`.
 *
 * The inverse of `dueStatusOf`, for dragging a card into a lane. Two deliberate
 * choices:
 *   • Later clears the due date rather than inventing a future one — "later"
 *     means unscheduled, and guessing a date would put words in the user's mouth.
 *     A card already due in the future is already in Later and never moves here.
 *   • Pausing keeps the due date, so unpausing restores the original schedule
 *     instead of losing it.
 *
 * Returns `null` for Overdue, which is not a reachable target.
 */
export function scheduleForStatus(
  status: DueStatus,
  today: Date,
  current: SchedulableCard,
): { dueDate: Date | null; pausedAt: Date | null } | null {
  switch (status) {
    case "paused":
      return { dueDate: current.dueDate, pausedAt: current.pausedAt ?? today };
    case "dueNow":
      return { dueDate: startOfUtcDay(today), pausedAt: null };
    case "later":
      return { dueDate: null, pausedAt: null };
    case "overdue":
      return null;
  }
}

/**
 * Midnight UTC of the calendar day `instant` falls on in the server's timezone —
 * the shape a `@db.Date` column expects.
 */
export function startOfUtcDay(instant: Date): Date {
  return new Date(`${dayKeyOfInstant(instant)}T00:00:00.000Z`);
}

/** Parse a `YYYY-MM-DD` form value into a `@db.Date` value. Invalid input → null. */
export function parseDueDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Group cards into lanes, preserving the order they arrive in. */
export function groupByDueStatus<T extends SchedulableCard>(
  cards: readonly T[],
  now: Date,
): Record<DueStatus, T[]> {
  const groups: Record<DueStatus, T[]> = {
    overdue: [],
    dueNow: [],
    later: [],
    paused: [],
  };
  for (const card of cards) groups[dueStatusOf(card, now)].push(card);
  return groups;
}
