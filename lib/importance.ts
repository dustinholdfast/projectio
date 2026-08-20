import {
  type DueStatus,
  daysUntilDue,
  dueStatusOf,
} from "@/lib/due-status";

// Cross-board ranking for the Focus pane.
//
// A board is the right place to organise work. It is the wrong place to decide
// what to do next: overdue on one board is buried behind later work on another.
// Focus is that decision — one ranked queue over every board the user can see.
//
// Pure and framework-free so the weights are testable without Prisma or a clock
// (see test/importance.test.ts). The pane, the "do this now" card, and the
// lane filters all read from here rather than re-deriving the comparison.

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type FocusLane =
  | "focus"
  | "overdue"
  | "today"
  | "week"
  | "blocked"
  | "later"
  | "parked"
  | "done";

export const FOCUS_LANES: { id: FocusLane; label: string }[] = [
  { id: "focus", label: "Focus" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "blocked", label: "Blocked" },
  { id: "later", label: "Later" },
  { id: "parked", label: "Parked" },
  { id: "done", label: "Done" },
];

export const GROUP_ORDER = [
  "Overdue",
  "Due today",
  "This week",
  "Waiting",
  "Later",
  "Parked",
  "Done",
] as const;

export type FocusGroupLabel = (typeof GROUP_ORDER)[number];

/** Structural — tests need no Prisma, and the loader maps rows into this. */
export type RankableCard = {
  id: string;
  title: string;
  dueDate: Date | null;
  pausedAt: Date | null;
  completedAt: Date | null;
  priority: Priority | null;
  columnName: string;
  blockedBy: { title: string; completed: boolean }[];
  blocking: { title: string }[];
};

export type RankedCard = RankableCard & {
  status: DueStatus;
  score: number;
  reasons: string[];
  isBlocked: boolean;
  openBlockers: { title: string }[];
  daysUntilDue: number | null;
};

export type WorkspaceStats = {
  overdue: number;
  dueToday: number;
  thisWeek: number;
  blocked: number;
  open: number;
  parked: number;
  done: number;
};

const PRIORITY_WEIGHT: Record<Priority, number> = {
  URGENT: 50,
  HIGH: 25,
  MEDIUM: 12,
  LOW: 4,
};

function dueWeight(days: number | null, status: DueStatus): number {
  if (status === "completed") return -200;
  if (status === "paused") return 6;
  if (days === null) return 8;
  if (days < 0) return 100 + Math.min(40, Math.abs(days) * 8);
  if (days === 0) return 80;
  if (days <= 2) return 55;
  if (days <= 7) return 35;
  return 15;
}

function formatDueReason(days: number | null): string | null {
  if (days === null) return null;
  if (days < 0) {
    const n = Math.abs(days);
    return n === 1 ? "1 day overdue" : `${n} days overdue`;
  }
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 7) return `Due in ${days} days`;
  return null;
}

export function rankCard(card: RankableCard, now: Date): RankedCard {
  const status = dueStatusOf(card, now);
  const days = daysUntilDue(card.dueDate, now);
  const openBlockers = card.blockedBy.filter((blocker) => !blocker.completed);
  const isBlocked = openBlockers.length > 0;

  let score = dueWeight(days, status);
  score += card.priority ? PRIORITY_WEIGHT[card.priority] : 8;
  if (isBlocked) score -= 22;
  if (card.blocking.length > 0 && status !== "completed") {
    score += 8 + Math.min(16, card.blocking.length * 6);
  }
  if (card.columnName.toLowerCase() === "in progress") score += 6;

  const reasons: string[] = [];
  const dueReason = formatDueReason(days);
  if (dueReason && status !== "paused" && status !== "completed") {
    reasons.push(dueReason);
  }
  if (card.priority === "URGENT" || card.priority === "HIGH") {
    reasons.push(card.priority === "URGENT" ? "Urgent" : "High priority");
  }
  if (isBlocked) {
    reasons.push(
      openBlockers.length === 1
        ? `Waiting on ${openBlockers[0].title}`
        : `Waiting on ${openBlockers.length} tasks`,
    );
  }
  if (card.blocking.length > 0 && status !== "completed") {
    reasons.push(
      card.blocking.length === 1
        ? "Unblocks 1 task"
        : `Unblocks ${card.blocking.length} tasks`,
    );
  }
  if (status === "paused") reasons.push("Parked");

  return {
    ...card,
    status,
    score,
    reasons,
    isBlocked,
    openBlockers,
    daysUntilDue: days,
  };
}

export function rankCards(cards: RankableCard[], now: Date): RankedCard[] {
  return cards
    .map((card) => rankCard(card, now))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export function workspaceStats(ranked: RankedCard[]): WorkspaceStats {
  const stats: WorkspaceStats = {
    overdue: 0,
    dueToday: 0,
    thisWeek: 0,
    blocked: 0,
    open: 0,
    parked: 0,
    done: 0,
  };
  for (const card of ranked) {
    if (card.status === "completed") {
      stats.done += 1;
      continue;
    }
    stats.open += 1;
    if (card.status === "paused") stats.parked += 1;
    if (card.status === "overdue") stats.overdue += 1;
    if (card.status === "dueNow") stats.dueToday += 1;
    if (
      card.status !== "paused" &&
      card.daysUntilDue !== null &&
      card.daysUntilDue > 0 &&
      card.daysUntilDue <= 7
    ) {
      stats.thisWeek += 1;
    }
    if (card.isBlocked) stats.blocked += 1;
  }
  return stats;
}

/**
 * The Focus lane is the work that still wants a decision today: late, due now,
 * urgent/high, due this week, blocked, or unblocking someone else. Parked and
 * finished work have already been decided.
 */
export function matchesLane(card: RankedCard, lane: FocusLane): boolean {
  switch (lane) {
    case "focus":
      if (card.status === "completed" || card.status === "paused") return false;
      if (card.status === "overdue" || card.status === "dueNow") return true;
      if (card.isBlocked) return true;
      if (card.priority === "URGENT" || card.priority === "HIGH") return true;
      if (card.daysUntilDue !== null && card.daysUntilDue <= 7) return true;
      if (card.blocking.length > 0) return true;
      return false;
    case "overdue":
      return card.status === "overdue";
    case "today":
      return card.status === "dueNow";
    case "week":
      return (
        card.status !== "completed" &&
        card.status !== "paused" &&
        card.daysUntilDue !== null &&
        card.daysUntilDue > 0 &&
        card.daysUntilDue <= 7
      );
    case "blocked":
      return card.isBlocked && card.status !== "completed";
    case "later":
      return (
        card.status === "later" &&
        !card.isBlocked &&
        (card.daysUntilDue === null || card.daysUntilDue > 7)
      );
    case "parked":
      return card.status === "paused";
    case "done":
      return card.status === "completed";
  }
}

export function groupLabel(card: RankedCard): FocusGroupLabel {
  if (card.status === "completed") return "Done";
  if (card.status === "paused") return "Parked";
  if (card.status === "overdue") return "Overdue";
  if (card.status === "dueNow") return "Due today";
  if (card.isBlocked) return "Waiting";
  if (
    card.daysUntilDue !== null &&
    card.daysUntilDue > 0 &&
    card.daysUntilDue <= 7
  ) {
    return "This week";
  }
  return "Later";
}
