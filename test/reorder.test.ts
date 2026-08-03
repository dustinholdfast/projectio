import { describe, expect, it } from "vitest";

import {
  POSITION_STEP,
  midpointPosition,
  move,
  planCardMove,
  planColumnMove,
  type ReorderColumn,
} from "@/lib/reorder";

// ── Domain: the `position` Float scheme ──────────────────────────────────────

describe("midpointPosition", () => {
  it("returns the midpoint between two neighbors", () => {
    expect(midpointPosition(1000, 2000)).toBe(1500);
    expect(midpointPosition(0, 1000)).toBe(500);
  });

  it("steps past the single neighbor at either end", () => {
    expect(midpointPosition(1000, undefined)).toBe(1000 + POSITION_STEP);
    expect(midpointPosition(undefined, 1000)).toBe(1000 - POSITION_STEP);
  });

  it("uses the base step for an empty list", () => {
    expect(midpointPosition(undefined, undefined)).toBe(POSITION_STEP);
  });

  it("keeps a strictly-ascending order after repeated midpoint inserts", () => {
    let lo = 1000;
    const hi = 2000;
    // Drop repeatedly into the same gap; each result must stay strictly between.
    for (let i = 0; i < 5; i++) {
      const mid = midpointPosition(lo, hi);
      expect(mid).toBeGreaterThan(lo);
      expect(mid).toBeLessThan(hi);
      lo = mid;
    }
  });
});

describe("move", () => {
  it("moves an element forward without mutating the input", () => {
    const input = ["a", "b", "c"];
    expect(move(input, 0, 2)).toEqual(["b", "c", "a"]);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("moves an element backward", () => {
    expect(move(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
});

// ── Column reorder planning ──────────────────────────────────────────────────

describe("planColumnMove", () => {
  const columns = [{ id: "A" }, { id: "B" }, { id: "C" }];

  it("moves a column to the end, reporting the trailing neighbor", () => {
    expect(planColumnMove(columns, "A", "C")).toEqual({
      columnIds: ["B", "C", "A"],
      prevColumnId: "C",
      nextColumnId: null,
    });
  });

  it("moves a column to the front, reporting the leading neighbor", () => {
    expect(planColumnMove(columns, "C", "A")).toEqual({
      columnIds: ["C", "A", "B"],
      prevColumnId: null,
      nextColumnId: "A",
    });
  });

  it("reports both neighbors for a move into the middle", () => {
    expect(planColumnMove(columns, "A", "B")).toEqual({
      columnIds: ["B", "A", "C"],
      prevColumnId: "B",
      nextColumnId: "C",
    });
  });

  it("is a no-op when the column doesn't move or ids are unknown", () => {
    expect(planColumnMove(columns, "A", "A")).toBeNull();
    expect(planColumnMove(columns, "Z", "B")).toBeNull();
    expect(planColumnMove(columns, "A", "Z")).toBeNull();
  });
});

// ── Card reorder / move planning ─────────────────────────────────────────────

describe("planCardMove", () => {
  // colA: c1,c2,c3 | colB: c4,c5 | colC: (empty)
  const board = (): ReorderColumn[] => [
    { id: "colA", cards: [{ id: "c1" }, { id: "c2" }, { id: "c3" }] },
    { id: "colB", cards: [{ id: "c4" }, { id: "c5" }] },
    { id: "colC", cards: [] },
  ];

  it("reorders a card upward within its column", () => {
    expect(planCardMove(board(), "c3", { id: "c1", type: "card" })).toEqual({
      fromColumnId: "colA",
      toColumnId: "colA",
      cardIds: ["c3", "c1", "c2"],
      prevCardId: null,
      nextCardId: "c1",
    });
  });

  // Regression: same-column DOWNWARD drags were off-by-one — dropping onto the
  // next card silently no-op'd, and dropping further down landed one slot too high.
  it("reorders a card downward onto its neighbor (not a no-op)", () => {
    expect(planCardMove(board(), "c1", { id: "c2", type: "card" })).toEqual({
      fromColumnId: "colA",
      toColumnId: "colA",
      cardIds: ["c2", "c1", "c3"],
      prevCardId: "c2",
      nextCardId: "c3",
    });
  });

  it("reorders a card downward past a further card (lands below it)", () => {
    expect(planCardMove(board(), "c1", { id: "c3", type: "card" })).toEqual({
      fromColumnId: "colA",
      toColumnId: "colA",
      cardIds: ["c2", "c3", "c1"],
      prevCardId: "c3",
      nextCardId: null,
    });
  });

  // Regression: dropping a card back onto its own slot must not send it anywhere.
  it("is a no-op when a card is dropped on itself", () => {
    expect(planCardMove(board(), "c2", { id: "c2", type: "card" })).toBeNull();
  });

  it("moves a card into another column, inserting before the target card", () => {
    expect(planCardMove(board(), "c1", { id: "c5", type: "card" })).toEqual({
      fromColumnId: "colA",
      toColumnId: "colB",
      cardIds: ["c4", "c1", "c5"],
      prevCardId: "c4",
      nextCardId: "c5",
    });
  });

  it("moves a card into an empty column", () => {
    expect(planCardMove(board(), "c1", { id: "colC", type: "column" })).toEqual({
      fromColumnId: "colA",
      toColumnId: "colC",
      cardIds: ["c1"],
      prevCardId: null,
      nextCardId: null,
    });
  });

  it("appends when dropped on a non-empty column's empty area", () => {
    expect(planCardMove(board(), "c1", { id: "colB", type: "column" })).toEqual({
      fromColumnId: "colA",
      toColumnId: "colB",
      cardIds: ["c4", "c5", "c1"],
      prevCardId: "c5",
      nextCardId: null,
    });
  });

  it("returns null when the dragged card doesn't exist", () => {
    expect(planCardMove(board(), "nope", { id: "c1", type: "card" })).toBeNull();
  });
});
