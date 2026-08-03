import { describe, expect, it } from "vitest";

import {
  DUE_STATUS_DROPPABLE,
  DUE_STATUS_ORDER,
  dayKeyOfDueDate,
  dayKeyOfInstant,
  dueStatusOf,
  groupByDueStatus,
  parseDueDate,
  scheduleForStatus,
  startOfUtcDay,
} from "@/lib/due-status";

// Pure tests for the Overdue / Due Now / Later / Paused rules. No database and no
// clock: "now" is injected, so day-boundary behaviour is deterministic.

/** A `@db.Date` value: midnight UTC on the given day. */
const dueOn = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** An instant during the working day, in the local zone (as `new Date()` gives). */
const middayLocal = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

const NOW = middayLocal(2026, 8, 3);

describe("dueStatusOf", () => {
  it("is Overdue when the due day is before today", () => {
    expect(dueStatusOf({ dueDate: dueOn("2026-08-02"), pausedAt: null }, NOW)).toBe(
      "overdue",
    );
  });

  it("is Due Now on the due day itself", () => {
    expect(dueStatusOf({ dueDate: dueOn("2026-08-03"), pausedAt: null }, NOW)).toBe(
      "dueNow",
    );
  });

  it("is Later when the due day is still ahead", () => {
    expect(dueStatusOf({ dueDate: dueOn("2026-08-04"), pausedAt: null }, NOW)).toBe(
      "later",
    );
  });

  it("is Later when there is no due date — unscheduled is not late", () => {
    expect(dueStatusOf({ dueDate: null, pausedAt: null }, NOW)).toBe("later");
  });

  it("is Paused regardless of the date, even a past one", () => {
    // The point of pausing: parked work should stop nagging.
    expect(
      dueStatusOf({ dueDate: dueOn("2020-01-01"), pausedAt: NOW }, NOW),
    ).toBe("paused");
  });

  it("treats the day boundary as exact, not approximate", () => {
    const lateOnTheDueDay = middayLocal(2026, 8, 3);
    lateOnTheDueDay.setHours(23, 59, 59);
    expect(
      dueStatusOf({ dueDate: dueOn("2026-08-03"), pausedAt: null }, lateOnTheDueDay),
    ).toBe("dueNow");

    const justAfterMidnight = middayLocal(2026, 8, 4);
    justAfterMidnight.setHours(0, 0, 1);
    expect(
      dueStatusOf({ dueDate: dueOn("2026-08-03"), pausedAt: null }, justAfterMidnight),
    ).toBe("overdue");
  });

  it("compares across month and year ends", () => {
    const newYearsDay = middayLocal(2027, 1, 1);
    expect(
      dueStatusOf({ dueDate: dueOn("2026-12-31"), pausedAt: null }, newYearsDay),
    ).toBe("overdue");
    expect(
      dueStatusOf({ dueDate: dueOn("2027-01-01"), pausedAt: null }, newYearsDay),
    ).toBe("dueNow");
  });
});

describe("day keys", () => {
  it("reads a date-only value from its UTC components", () => {
    // @db.Date comes back as midnight UTC; reading local components here would
    // shift the day for anyone behind UTC.
    expect(dayKeyOfDueDate(dueOn("2026-08-03"))).toBe("2026-08-03");
  });

  it("reads an instant from its local components", () => {
    expect(dayKeyOfInstant(middayLocal(2026, 8, 3))).toBe("2026-08-03");
  });

  it("pads single-digit months and days", () => {
    expect(dayKeyOfInstant(middayLocal(2026, 1, 9))).toBe("2026-01-09");
  });
});

describe("scheduleForStatus", () => {
  const card = { dueDate: dueOn("2026-08-01"), pausedAt: null };

  it("refuses Overdue — it is not a state anyone can choose", () => {
    expect(scheduleForStatus("overdue", NOW, card)).toBeNull();
  });

  it("sets Due Now to today and unpauses", () => {
    const result = scheduleForStatus("dueNow", NOW, { ...card, pausedAt: NOW });
    expect(dayKeyOfDueDate(result!.dueDate!)).toBe("2026-08-03");
    expect(result!.pausedAt).toBeNull();
  });

  it("clears the date for Later rather than inventing a future one", () => {
    expect(scheduleForStatus("later", NOW, card)).toEqual({
      dueDate: null,
      pausedAt: null,
    });
  });

  it("keeps the due date when pausing, so resuming restores the schedule", () => {
    const result = scheduleForStatus("paused", NOW, card);
    expect(result!.dueDate).toEqual(card.dueDate);
    expect(result!.pausedAt).toEqual(NOW);
  });

  it("does not re-stamp an already-paused card", () => {
    const pausedEarlier = new Date("2026-07-01T09:00:00.000Z");
    const result = scheduleForStatus("paused", NOW, {
      dueDate: null,
      pausedAt: pausedEarlier,
    });
    expect(result!.pausedAt).toEqual(pausedEarlier);
  });

  it("round-trips: applying a status puts the card in that status", () => {
    for (const status of ["dueNow", "later", "paused"] as const) {
      const applied = scheduleForStatus(status, NOW, card)!;
      expect(dueStatusOf(applied, NOW)).toBe(status);
    }
  });
});

describe("parseDueDate", () => {
  it("accepts YYYY-MM-DD and anchors it at midnight UTC", () => {
    expect(parseDueDate("2026-08-03")!.toISOString()).toBe(
      "2026-08-03T00:00:00.000Z",
    );
  });

  it("rejects anything else", () => {
    for (const bad of ["", "03/08/2026", "2026-8-3", "tomorrow", "2026-08-03T10:00"]) {
      expect(parseDueDate(bad)).toBeNull();
    }
  });
});

describe("startOfUtcDay", () => {
  it("maps an instant to midnight UTC of its local calendar day", () => {
    expect(startOfUtcDay(middayLocal(2026, 8, 3)).toISOString()).toBe(
      "2026-08-03T00:00:00.000Z",
    );
  });
});

describe("groupByDueStatus", () => {
  it("puts every card in exactly one lane", () => {
    const cards = [
      { id: "a", dueDate: dueOn("2026-08-01"), pausedAt: null },
      { id: "b", dueDate: dueOn("2026-08-03"), pausedAt: null },
      { id: "c", dueDate: dueOn("2026-09-01"), pausedAt: null },
      { id: "d", dueDate: null, pausedAt: null },
      { id: "e", dueDate: dueOn("2026-08-01"), pausedAt: NOW },
    ];

    const groups = groupByDueStatus(cards, NOW);

    expect(groups.overdue.map((c) => c.id)).toEqual(["a"]);
    expect(groups.dueNow.map((c) => c.id)).toEqual(["b"]);
    expect(groups.later.map((c) => c.id)).toEqual(["c", "d"]);
    expect(groups.paused.map((c) => c.id)).toEqual(["e"]);

    const total = DUE_STATUS_ORDER.reduce((n, s) => n + groups[s].length, 0);
    expect(total).toBe(cards.length);
  });

  it("preserves the order cards arrive in", () => {
    const cards = [
      { id: "second", dueDate: dueOn("2026-09-02"), pausedAt: null },
      { id: "first", dueDate: dueOn("2026-09-01"), pausedAt: null },
    ];
    expect(groupByDueStatus(cards, NOW).later.map((c) => c.id)).toEqual([
      "second",
      "first",
    ]);
  });

  it("returns an entry for every lane, even empty ones", () => {
    const groups = groupByDueStatus([], NOW);
    for (const status of DUE_STATUS_ORDER) expect(groups[status]).toEqual([]);
  });
});

describe("lane rules", () => {
  it("orders lanes most-urgent first", () => {
    expect(DUE_STATUS_ORDER).toEqual(["overdue", "dueNow", "later", "paused"]);
  });

  it("makes Overdue the only lane you cannot drop into", () => {
    expect(DUE_STATUS_DROPPABLE.overdue).toBe(false);
    expect(DUE_STATUS_DROPPABLE.dueNow).toBe(true);
    expect(DUE_STATUS_DROPPABLE.later).toBe(true);
    expect(DUE_STATUS_DROPPABLE.paused).toBe(true);
  });
});
