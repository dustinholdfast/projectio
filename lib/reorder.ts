// Pure, framework-free reorder + ordering logic for the board.
//
// Two concerns live here so they can be unit-tested in isolation from React and
// Prisma:
//   1. The `position` Float scheme (append spacing + midpoint) shared by the
//      server actions in lib/actions/board.ts.
//   2. The drag-drop "plan" functions that decide, from the current board state
//      and a drop target, where an item lands and which neighbors bound it — the
//      logic the board view (components/board/board-view.tsx) applies optimistically
//      and then persists via the reorder server actions.
//
// Keeping these pure means the board view holds only wiring (event → plan →
// state + persist), and the ordering rules are covered by fast, deterministic
// tests (see test/reorder.test.ts).

// Gap between appended siblings and the fallback step at either end of a list.
// Matches the seed's spacing so positions stay comfortably far apart before any
// rebalance would be needed.
export const POSITION_STEP = 1000;

/**
 * Position for an item dropped between `prev` and `next` (either may be absent at
 * an end of the list): the midpoint of two neighbors, or a fixed step beyond the
 * single neighbor, or the base step for an empty list.
 */
export function midpointPosition(
  prev: number | undefined,
  next: number | undefined,
): number {
  if (prev !== undefined && next !== undefined) return (prev + next) / 2;
  if (prev !== undefined) return prev + POSITION_STEP;
  if (next !== undefined) return next - POSITION_STEP;
  return POSITION_STEP;
}

/** Immutable array move: remove the item at `from` and reinsert it at `to`. */
export function move<T>(arr: readonly T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ── Drag-drop planning ───────────────────────────────────────────────────────
//
// A "plan" is the outcome of a drop computed against the current arrangement: the
// resulting id order plus the moved item's new neighbors (for the midpoint write).
// `null` means the drop is a no-op (dropped on its own slot, or nothing changed)
// and the caller should ignore it.

/** Minimal board shape the planners need — id order is all that matters. */
export type ReorderColumn = { id: string; cards: readonly { id: string }[] };

/** What the caller drops onto: another card, or a column's empty area. */
export type DropTarget = { id: string; type: "card" | "column" };

export type ColumnMovePlan = {
  /** Column ids in their new left-to-right order. */
  columnIds: string[];
  prevColumnId: string | null;
  nextColumnId: string | null;
};

/**
 * Plan a column reorder. `overColumnId` is the column the drag ended over (when a
 * column is dropped onto a card, the caller resolves that card's column first).
 * Returns `null` when the column didn't move.
 */
export function planColumnMove(
  columns: readonly { id: string }[],
  columnId: string,
  overColumnId: string,
): ColumnMovePlan | null {
  const oldIndex = columns.findIndex((c) => c.id === columnId);
  const newIndex = columns.findIndex((c) => c.id === overColumnId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null;

  const columnIds = move(
    columns.map((c) => c.id),
    oldIndex,
    newIndex,
  );
  const pos = columnIds.indexOf(columnId);
  return {
    columnIds,
    prevColumnId: columnIds[pos - 1] ?? null,
    nextColumnId: columnIds[pos + 1] ?? null,
  };
}

export type CardMovePlan = {
  fromColumnId: string;
  toColumnId: string;
  /** Card ids of the destination column in their new top-to-bottom order. */
  cardIds: string[];
  prevCardId: string | null;
  nextCardId: string | null;
};

/**
 * Plan a card move — within its column or into another column of the same board.
 *
 * Same-column and cross-column drops use different rules:
 *   • same column → reorder with `move` (correct in both directions, unlike a
 *     naive insert-before which only works for upward drags);
 *   • cross column → insert the card *before* the card it was dropped onto, or at
 *     the end when dropped on a column's empty area.
 *
 * Returns `null` for no-ops: card/target not found, a card dropped back onto its
 * own slot, or a same-column drop that doesn't change the order.
 */
export function planCardMove(
  columns: readonly ReorderColumn[],
  cardId: string,
  over: DropTarget,
): CardMovePlan | null {
  const fromCol = columns.find((c) => c.cards.some((k) => k.id === cardId));
  if (!fromCol) return null;

  const toCol =
    over.type === "column"
      ? columns.find((c) => c.id === over.id)
      : columns.find((c) => c.cards.some((k) => k.id === over.id));
  if (!toCol) return null;

  let cardIds: string[];
  if (fromCol.id === toCol.id) {
    // Dropping a card back onto its own slot is a no-op.
    if (over.type === "card" && over.id === cardId) return null;

    const fromIds = fromCol.cards.map((k) => k.id);
    const oldIndex = fromIds.indexOf(cardId);
    const overIndex = over.type === "card" ? fromIds.indexOf(over.id) : -1;
    const newIndex = overIndex < 0 ? fromIds.length - 1 : overIndex;
    if (oldIndex === newIndex) return null;

    cardIds = move(fromIds, oldIndex, newIndex);
  } else {
    const without = toCol.cards.map((k) => k.id);
    let insertIndex: number;
    if (over.type === "card") {
      const overIndex = without.indexOf(over.id);
      insertIndex = overIndex < 0 ? without.length : overIndex;
    } else {
      insertIndex = without.length;
    }
    cardIds = [...without.slice(0, insertIndex), cardId, ...without.slice(insertIndex)];
  }

  const idx = cardIds.indexOf(cardId);
  return {
    fromColumnId: fromCol.id,
    toColumnId: toCol.id,
    cardIds,
    prevCardId: cardIds[idx - 1] ?? null,
    nextCardId: cardIds[idx + 1] ?? null,
  };
}
