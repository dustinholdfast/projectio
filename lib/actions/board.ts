"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { POSITION_STEP, midpointPosition } from "@/lib/reorder";

// Server actions backing the board screens: create/rename/delete a board, and
// add columns and cards to one. Every action re-reads the session and verifies
// the target belongs to the current user before writing, so a forged id can
// never mutate another account's data. Ordering uses the `position` Float scheme
// (see prisma/schema.prisma): a new sibling is appended by taking the current max
// position plus a fixed step, leaving room for a later drag-drop insert to take a
// midpoint between neighbors.

// Shape returned to the client forms via `useActionState`. `undefined` is the
// initial (no-error) state; a populated `error` is rendered under the form. The
// `position` scheme (append step + midpoint) lives in @/lib/reorder so it can be
// unit-tested independently of these server actions.
export type BoardActionState = { error: string } | undefined;

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * Refresh both views a board write can affect: the board itself, and the list,
 * whose per-board column/card counts change with it.
 */
function revalidateBoard(boardId: string): void {
  revalidatePath(`/board/${boardId}`);
  revalidatePath("/");
}

/** Longest accepted board name — enough for a real title, short enough to render. */
const MAX_BOARD_NAME = 80;

function readBoardName(formData: FormData): string {
  return String(formData.get("name") ?? "")
    .trim()
    .slice(0, MAX_BOARD_NAME);
}

/** Create a board and open it. */
export async function createBoard(
  _prevState: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const userId = await requireUserId();
  if (!userId) return { error: "Your session has expired. Please sign in again." };

  const name = readBoardName(formData);
  if (!name) return { error: "Enter a name for your board." };

  const board = await prisma.board.create({
    data: { name, ownerId: userId },
    select: { id: true },
  });

  revalidatePath("/");
  // Straight into the new board — creating one and then having to find it in the
  // list would be a pointless extra step.
  redirect(`/board/${board.id}`);
}

/** Rename a board the current user owns. */
export async function renameBoard(
  _prevState: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const userId = await requireUserId();
  if (!userId) return { error: "Your session has expired. Please sign in again." };

  const boardId = String(formData.get("boardId") ?? "");
  const name = readBoardName(formData);
  if (!boardId) return { error: "Missing board." };
  if (!name) return { error: "Enter a name for your board." };

  // Scoping the update by ownerId means a forged boardId matches zero rows
  // rather than renaming someone else's board.
  const result = await prisma.board.updateMany({
    where: { id: boardId, ownerId: userId },
    data: { name },
  });
  if (result.count === 0) return { error: "Board not found." };

  revalidateBoard(boardId);
}

/**
 * Delete a board the current user owns, and return to the list.
 *
 * Columns and cards go with it via the schema's cascade — there is no separate
 * cleanup, and no way to recover it, which is why the UI confirms first.
 */
export async function deleteBoard(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  if (!userId) redirect("/login");

  const boardId = String(formData.get("boardId") ?? "");
  if (boardId) {
    await prisma.board.deleteMany({ where: { id: boardId, ownerId: userId } });
  }

  revalidatePath("/");
  redirect("/");
}

/** Append a new column to a board the current user owns. */
export async function createColumn(
  _prevState: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const userId = await requireUserId();
  if (!userId) return { error: "Your session has expired. Please sign in again." };

  const boardId = String(formData.get("boardId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!boardId) return { error: "Missing board." };
  if (!name) return { error: "Enter a column name." };

  // Ownership check: the board must belong to the current user.
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { ownerId: true },
  });
  if (!board || board.ownerId !== userId) {
    return { error: "Board not found." };
  }

  const last = await prisma.column.findFirst({
    where: { boardId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  await prisma.column.create({
    data: {
      name,
      boardId,
      position: (last?.position ?? 0) + POSITION_STEP,
    },
  });

  revalidateBoard(boardId);
}

/** Append a new card to a column whose board the current user owns. */
export async function createCard(
  _prevState: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const userId = await requireUserId();
  if (!userId) return { error: "Your session has expired. Please sign in again." };

  const columnId = String(formData.get("columnId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!columnId) return { error: "Missing column." };
  if (!title) return { error: "Enter a card title." };

  // Ownership check: walk column → board → owner in one query. `boardId` comes
  // back too, so the revalidation below can target this board's route.
  const column = await prisma.column.findUnique({
    where: { id: columnId },
    select: { boardId: true, board: { select: { ownerId: true } } },
  });
  if (!column || column.board.ownerId !== userId) {
    return { error: "Column not found." };
  }

  const last = await prisma.card.findFirst({
    where: { columnId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  await prisma.card.create({
    data: {
      title,
      description: description || null,
      columnId,
      position: (last?.position ?? 0) + POSITION_STEP,
    },
  });

  revalidateBoard(column.boardId);
}

// ── Drag-drop reordering ────────────────────────────────────────────────────
//
// The board's drag-drop UI (components/board/board-view.tsx) reorders optimistically
// in local state, then calls one of these actions to persist the move. Both use the
// midpoint `position` scheme: the client sends the moved item plus the ids of the
// neighbors it now sits between (either may be null at an end), and the server writes
// a single row — the new position is the midpoint of the neighbor positions, so a
// reorder is always O(1) writes and never rewrites untouched siblings.

// Result of a reorder. `undefined` means success (nothing to render); a populated
// `error` tells the client to roll back its optimistic state and refresh.
export type ReorderResult = { error: string } | undefined;

/** Persist a column move within its board. Neighbors are the columns it now sits between. */
export async function reorderColumn(input: {
  columnId: string;
  prevColumnId: string | null;
  nextColumnId: string | null;
}): Promise<ReorderResult> {
  const userId = await requireUserId();
  if (!userId) return { error: "Your session has expired. Please sign in again." };

  // Ownership: the moved column must belong to a board the current user owns.
  const column = await prisma.column.findUnique({
    where: { id: input.columnId },
    select: { boardId: true, board: { select: { ownerId: true } } },
  });
  if (!column || column.board.ownerId !== userId) {
    return { error: "Column not found." };
  }

  // Read neighbor positions scoped to the same board so a forged neighbor id from
  // another board can never influence the computed position.
  const [prev, next] = await Promise.all([
    input.prevColumnId
      ? prisma.column.findFirst({
          where: { id: input.prevColumnId, boardId: column.boardId },
          select: { position: true },
        })
      : null,
    input.nextColumnId
      ? prisma.column.findFirst({
          where: { id: input.nextColumnId, boardId: column.boardId },
          select: { position: true },
        })
      : null,
  ]);

  await prisma.column.update({
    where: { id: input.columnId },
    data: { position: midpointPosition(prev?.position, next?.position) },
  });

  revalidateBoard(column.boardId);
}

/**
 * Persist a card move — within its column or into another column of the same board.
 * Neighbors are the cards it now sits between in the target column.
 */
export async function reorderCard(input: {
  cardId: string;
  toColumnId: string;
  prevCardId: string | null;
  nextCardId: string | null;
}): Promise<ReorderResult> {
  const userId = await requireUserId();
  if (!userId) return { error: "Your session has expired. Please sign in again." };

  // Ownership: both the moved card and the destination column must belong to a
  // board the current user owns. Reading the board id off each lets us also reject
  // moves that would cross boards.
  const [card, toColumn] = await Promise.all([
    prisma.card.findUnique({
      where: { id: input.cardId },
      select: { column: { select: { boardId: true, board: { select: { ownerId: true } } } } },
    }),
    prisma.column.findUnique({
      where: { id: input.toColumnId },
      select: { boardId: true, board: { select: { ownerId: true } } },
    }),
  ]);
  if (!card || card.column.board.ownerId !== userId) {
    return { error: "Card not found." };
  }
  if (!toColumn || toColumn.board.ownerId !== userId) {
    return { error: "Column not found." };
  }
  if (card.column.boardId !== toColumn.boardId) {
    return { error: "Cards can only move within the same board." };
  }

  // Neighbor positions are scoped to the destination column so ids from a different
  // column (or a stale drop) can't skew the midpoint.
  const [prev, next] = await Promise.all([
    input.prevCardId
      ? prisma.card.findFirst({
          where: { id: input.prevCardId, columnId: input.toColumnId },
          select: { position: true },
        })
      : null,
    input.nextCardId
      ? prisma.card.findFirst({
          where: { id: input.nextCardId, columnId: input.toColumnId },
          select: { position: true },
        })
      : null,
  ]);

  await prisma.card.update({
    where: { id: input.cardId },
    data: {
      columnId: input.toColumnId,
      position: midpointPosition(prev?.position, next?.position),
    },
  });

  revalidateBoard(toColumn.boardId);
}
