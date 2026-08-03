import { describe, expect, it } from "vitest";

import {
  buildBlockGraph,
  checkBlockAllowed,
  dependsOn,
} from "@/lib/card-blocks";

// Cycle detection is the reason this logic is pure and separately tested. A cycle
// that reaches the database is unrecoverable through the UI — every card in the
// loop refuses to move and no screen shows you the loop — so the interesting
// cases are the ones that close a loop through several hops, not the obvious
// self-link.

/** `a <- b` reads "a is blocked by b". */
const graph = (...edges: [string, string][]) =>
  buildBlockGraph(edges.map(([blockedId, blockerId]) => ({ blockedId, blockerId })));

describe("dependsOn", () => {
  it("finds a direct dependency", () => {
    expect(dependsOn(graph(["a", "b"]), "a", "b")).toBe(true);
  });

  it("finds one several hops away", () => {
    expect(dependsOn(graph(["a", "b"], ["b", "c"], ["c", "d"]), "a", "d")).toBe(
      true,
    );
  });

  it("is directional — b does not depend on a just because a depends on b", () => {
    expect(dependsOn(graph(["a", "b"]), "b", "a")).toBe(false);
  });

  it("returns false for an unknown card", () => {
    expect(dependsOn(graph(["a", "b"]), "nobody", "b")).toBe(false);
  });

  it("terminates on a graph that already contains a cycle", () => {
    // Should not be possible through the actions, but bad data or a race must
    // not hang the request.
    expect(dependsOn(graph(["a", "b"], ["b", "a"]), "a", "zzz")).toBe(false);
  });

  it("handles a long chain without recursing", () => {
    const edges: [string, string][] = [];
    for (let i = 0; i < 5000; i++) edges.push([`n${i}`, `n${i + 1}`]);
    expect(dependsOn(graph(...edges), "n0", "n5000")).toBe(true);
  });

  it("explores every branch, not just the first", () => {
    // a waits on b and c; only the c branch reaches d.
    const g = graph(["a", "b"], ["a", "c"], ["c", "d"]);
    expect(dependsOn(g, "a", "d")).toBe(true);
  });
});

describe("checkBlockAllowed", () => {
  it("allows an unrelated link", () => {
    expect(checkBlockAllowed(graph(), "a", "b")).toBeNull();
  });

  it("rejects a card blocking itself", () => {
    expect(checkBlockAllowed(graph(), "a", "a")).toBe("self");
  });

  it("rejects a duplicate", () => {
    expect(checkBlockAllowed(graph(["a", "b"]), "a", "b", ["b"])).toBe("duplicate");
  });

  it("rejects a direct two-card loop", () => {
    // b already waits on a, so making a wait on b closes the loop.
    expect(checkBlockAllowed(graph(["b", "a"]), "a", "b")).toBe("cycle");
  });

  it("rejects a loop that closes through several hops", () => {
    // c <- b <- a, so a waiting on c would close a -> c -> b -> a.
    const g = graph(["c", "b"], ["b", "a"]);
    expect(checkBlockAllowed(g, "a", "c")).toBe("cycle");
  });

  it("allows a diamond — shared dependencies are not cycles", () => {
    // b and c both wait on d; a waiting on both is fine.
    const g = graph(["b", "d"], ["c", "d"], ["a", "b"]);
    expect(checkBlockAllowed(g, "a", "c", ["b"])).toBeNull();
  });

  it("checks self before duplicate, so the message names the real problem", () => {
    expect(checkBlockAllowed(graph(), "a", "a", ["a"])).toBe("self");
  });
});

describe("buildBlockGraph", () => {
  it("groups multiple blockers under one card", () => {
    const g = buildBlockGraph([
      { blockedId: "a", blockerId: "b" },
      { blockedId: "a", blockerId: "c" },
    ]);
    expect(g.get("a")).toEqual(["b", "c"]);
  });

  it("returns an empty graph for no rows", () => {
    expect(buildBlockGraph([]).size).toBe(0);
  });
});
