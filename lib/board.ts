import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Read helpers for the board screens. Every query is scoped to the session user,
// so a board is only ever loaded for the account that owns it — an unowned id and
// an unknown one are indistinguishable, and the caller 404s either way rather
// than confirming that someone else's board exists.
//
// Columns and cards come back already ordered by their `position` Float
// (ascending = left-to-right for columns, top-to-bottom for cards) so the view
// renders them in order without sorting client-side.

export type BoardWithColumns = NonNullable<
  Awaited<ReturnType<typeof getBoardForUser>>
>;
export type ColumnWithCards = BoardWithColumns["columns"][number];
export type BoardCard = ColumnWithCards["cards"][number];

export type BoardSummary = {
  id: string;
  name: string;
  updatedAt: Date;
  columnCount: number;
  cardCount: number;
};

/**
 * Every board owned by the signed-in user, most recently touched first, with the
 * counts the list screen shows.
 *
 * Counts come from `_count` aggregates rather than loading the cards themselves:
 * the list needs totals only, and a user with large boards should not pay to
 * fetch every card just to render a summary line.
 */
export async function getUserBoards(): Promise<BoardSummary[]> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return [];

  const boards = await prisma.board.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      columns: { select: { _count: { select: { cards: true } } } },
    },
  });

  return boards.map((board) => ({
    id: board.id,
    name: board.name,
    updatedAt: board.updatedAt,
    columnCount: board.columns.length,
    cardCount: board.columns.reduce((sum, column) => sum + column._count.cards, 0),
  }));
}

/**
 * One board with its columns and cards, or `null` when there is no session or
 * the board does not exist / belongs to someone else. The ownership filter is
 * part of the query rather than a check applied to the result, so there is no
 * window in which another account's board has been loaded.
 */
export async function getBoardForUser(boardId: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  return prisma.board.findFirst({
    where: { id: boardId, ownerId: userId },
    include: {
      columns: {
        orderBy: { position: "asc" },
        include: {
          cards: {
            orderBy: { position: "asc" },
            include: {
              checklist: { orderBy: { position: "asc" } },
              // Only the blocker's id and title: the dialog lists what a card is
              // waiting on, and pulling whole blocker cards here would fan out
              // into a second copy of most of the board.
              blockedBy: {
                orderBy: { createdAt: "asc" },
                select: {
                  blockerId: true,
                  blocker: { select: { id: true, title: true, completedAt: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}
