import { describe, expect, it } from "vitest";

import {
  groupLabel,
  matchesLane,
  rankCard,
  rankCards,
  workspaceStats,
  type RankableCard,
} from "@/lib/importance";

// Pure tests for the Focus ranking. No database and no clock: "now" is injected
// so day-boundary behaviour is deterministic.

const dueOn = (day: string) => new Date(`${day}T00:00:00.000Z`);
const middayLocal = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d, 12, 0, 0);

const NOW = middayLocal(2026, 8, 3);

function card(overrides: Partial<RankableCard> = {}): RankableCard {
  return {
    id: "c1",
    title: "A task",
    dueDate: null,
    pausedAt: null,
    completedAt: null,
    priority: null,
    columnName: "To Do",
    blockedBy: [],
    blocking: [],
    ...overrides,
  };
}

describe("rankCard", () => {
  it("ranks an overdue urgent card above a later one", () => {
    const late = rankCard(
      card({
        title: "Late",
        dueDate: dueOn("2026-07-31"),
        priority: "URGENT",
      }),
      NOW,
    );
    const later = rankCard(
      card({ title: "Later", dueDate: dueOn("2026-08-20") }),
      NOW,
    );
    expect(late.score).toBeGreaterThan(later.score);
    expect(late.reasons).toContain("3 days overdue");
    expect(late.reasons).toContain("Urgent");
  });

  it("treats due today as more important than due this week", () => {
    const today = rankCard(card({ dueDate: dueOn("2026-08-03") }), NOW);
    const week = rankCard(card({ dueDate: dueOn("2026-08-07") }), NOW);
    expect(today.score).toBeGreaterThan(week.score);
    expect(today.reasons).toContain("Due today");
    expect(week.reasons).toContain("Due in 4 days");
  });

  it("drops a blocked card below an otherwise identical one", () => {
    const blocked = rankCard(
      card({
        title: "Blocked",
        dueDate: dueOn("2026-08-03"),
        blockedBy: [{ title: "Setup", completed: false }],
      }),
      NOW,
    );
    const free = rankCard(
      card({ title: "Free", dueDate: dueOn("2026-08-03") }),
      NOW,
    );
    expect(blocked.score).toBeLessThan(free.score);
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.reasons).toContain("Waiting on Setup");
  });

  it("ignores finished blockers when deciding if a card is waiting", () => {
    const ranked = rankCard(
      card({
        blockedBy: [{ title: "Done already", completed: true }],
      }),
      NOW,
    );
    expect(ranked.isBlocked).toBe(false);
  });

  it("boosts a card that unblocks others", () => {
    const keystone = rankCard(
      card({
        title: "Keystone",
        blocking: [{ title: "Downstream" }],
      }),
      NOW,
    );
    const lone = rankCard(card({ title: "Lone" }), NOW);
    expect(keystone.score).toBeGreaterThan(lone.score);
    expect(keystone.reasons).toContain("Unblocks 1 task");
  });

  it("parks completed work at the bottom, even if it is late and urgent", () => {
    const done = rankCard(
      card({
        dueDate: dueOn("2026-01-01"),
        priority: "URGENT",
        completedAt: dueOn("2026-08-01"),
      }),
      NOW,
    );
    const later = rankCard(card({ title: "Still open" }), NOW);
    expect(done.status).toBe("completed");
    expect(done.score).toBeLessThan(later.score);
  });

  it("sorts equal scores alphabetically so the queue is stable", () => {
    const ranked = rankCards(
      [
        card({ id: "b", title: "Beta" }),
        card({ id: "a", title: "Alpha" }),
      ],
      NOW,
    );
    expect(ranked.map((item) => item.title)).toEqual(["Alpha", "Beta"]);
  });
});

describe("matchesLane", () => {
  it("puts overdue, due-now, urgent, and blocked work in Focus", () => {
    expect(
      matchesLane(
        rankCard(card({ dueDate: dueOn("2026-08-01") }), NOW),
        "focus",
      ),
    ).toBe(true);
    expect(
      matchesLane(rankCard(card({ priority: "HIGH" }), NOW), "focus"),
    ).toBe(true);
    expect(
      matchesLane(
        rankCard(card({ completedAt: dueOn("2026-08-01") }), NOW),
        "focus",
      ),
    ).toBe(false);
    expect(
      matchesLane(
        rankCard(card({ pausedAt: NOW, dueDate: dueOn("2026-08-01") }), NOW),
        "focus",
      ),
    ).toBe(false);
  });

  it("keeps unscheduled unblocked work out of Focus and in Later", () => {
    const ranked = rankCard(card({ title: "Someday" }), NOW);
    expect(matchesLane(ranked, "focus")).toBe(false);
    expect(matchesLane(ranked, "later")).toBe(true);
    expect(groupLabel(ranked)).toBe("Later");
  });
});

describe("workspaceStats", () => {
  it("counts open work without double-counting completed", () => {
    const ranked = rankCards(
      [
        card({ id: "1", title: "Late", dueDate: dueOn("2026-08-01") }),
        card({ id: "2", title: "Today", dueDate: dueOn("2026-08-03") }),
        card({
          id: "3",
          title: "Done",
          dueDate: dueOn("2026-08-01"),
          completedAt: dueOn("2026-08-02"),
        }),
      ],
      NOW,
    );
    const stats = workspaceStats(ranked);
    expect(stats.overdue).toBe(1);
    expect(stats.dueToday).toBe(1);
    expect(stats.open).toBe(2);
    expect(stats.done).toBe(1);
  });
});
