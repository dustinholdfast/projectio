// Dependency-graph rules for "card A is blocked by card B".
//
// Pure and framework-free so the graph reasoning is testable without a database:
// cycle detection is the kind of logic that looks obviously correct and quietly
// is not, and a cycle in production is unrecoverable through the UI — every card
// in the loop refuses to move, and there is no screen that shows you the loop.

/** Adjacency: card id → the ids of cards it is blocked by. */
export type BlockGraph = ReadonlyMap<string, readonly string[]>;

export type BlockRejection =
  | "self"
  | "cycle"
  | "duplicate"
  | "cross-board"
  | null;

/**
 * Whether `blockerId` may be added as a blocker of `blockedId`.
 *
 * Returns `null` when the link is allowed, or the reason it is not. Reasons are
 * distinct so the UI can explain the refusal — "that would create a loop" is
 * actionable, "invalid" is not.
 */
export function checkBlockAllowed(
  graph: BlockGraph,
  blockedId: string,
  blockerId: string,
  existing: readonly string[] = [],
): BlockRejection {
  if (blockedId === blockerId) return "self";
  if (existing.includes(blockerId)) return "duplicate";

  // A cycle appears exactly when the proposed blocker already depends —
  // directly or through any chain — on the card being blocked. Walking from the
  // blocker and looking for the blocked card answers that in one traversal.
  if (dependsOn(graph, blockerId, blockedId)) return "cycle";

  return null;
}

/**
 * Does `fromId` depend on `targetId`, directly or transitively?
 *
 * Iterative depth-first with a visited set: recursion would risk a stack
 * overflow on a long chain, and the visited set means a graph that *already*
 * contains a cycle (from older data, or a race between two writers) terminates
 * instead of hanging.
 */
export function dependsOn(
  graph: BlockGraph,
  fromId: string,
  targetId: string,
): boolean {
  const seen = new Set<string>();
  const stack = [...(graph.get(fromId) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === targetId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(graph.get(current) ?? []));
  }

  return false;
}

/** Build the adjacency map from flat rows, as stored in `CardBlock`. */
export function buildBlockGraph(
  rows: readonly { blockedId: string; blockerId: string }[],
): BlockGraph {
  const graph = new Map<string, string[]>();
  for (const row of rows) {
    const blockers = graph.get(row.blockedId);
    if (blockers) blockers.push(row.blockerId);
    else graph.set(row.blockedId, [row.blockerId]);
  }
  return graph;
}

/** Human-readable reason, for inline display. */
export const BLOCK_REJECTION_MESSAGE: Record<
  NonNullable<BlockRejection>,
  string
> = {
  self: "A card cannot block itself.",
  cycle: "That would create a loop — the other card already waits on this one.",
  duplicate: "That card is already listed as a blocker.",
  "cross-board": "Cards can only be blocked by cards on the same board.",
};
