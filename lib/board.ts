import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roleOfUser, type BoardRole } from "@/lib/authz";

// Read helpers for the board screens. Every query is scoped by *membership*, so a
// board is only ever loaded for an account that has been granted access — a board
// the user is not a member of and one that does not exist are indistinguishable,
// and the caller 404s either way rather than confirming someone else's board is
// there.
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
  /** The signed-in user's role on this board. */
  role: BoardRole;
  /** How many people can see it, owner included. 1 = not shared. */
  memberCount: number;
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

  // Owned and shared boards belong in the same list.
  const boards = await prisma.board.findMany({
    where: {
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      ownerId: true,
      updatedAt: true,
      columns: { select: { _count: { select: { cards: true } } } },
      _count: { select: { members: true } },
      // Just this user's row, to label the tile with their own role.
      members: { where: { userId }, select: { role: true } },
    },
  });

  return boards.map((board) => ({
    id: board.id,
    name: board.name,
    updatedAt: board.updatedAt,
    columnCount: board.columns.length,
    cardCount: board.columns.reduce((sum, column) => sum + column._count.cards, 0),
    role:
      board.ownerId === userId
        ? "OWNER"
        : (board.members[0]?.role ?? "VIEWER"),
    memberCount: board._count.members + 1,
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
    // The access filter is part of the query, so an inaccessible board is
    // indistinguishable from one that does not exist.
    where: {
      id: boardId,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
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

export type BoardMemberSummary = {
  userId: string;
  email: string;
  name: string | null;
  role: BoardRole;
  isYou: boolean;
};

export type ShareLinkSummary = {
  id: string;
  tokenPrefix: string;
  role: BoardRole;
  createdAt: Date;
  revokedAt: Date | null;
  expiresAt: Date;
};

/**
 * Members and share links for the sharing panel.
 *
 * Owner-only data: a viewer has no business seeing the full membership list or
 * even the non-secret prefixes used to distinguish managed links.
 * Returns null for anyone who is not the owner, and the caller renders nothing.
 */
export async function getBoardSharing(boardId: string): Promise<{
  members: BoardMemberSummary[];
  links: ShareLinkSummary[];
} | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const role = await roleOfUser(boardId, userId);
  if (role !== "OWNER") return null;

  const [board, members, links] = await Promise.all([
    prisma.board.findUnique({
      where: { id: boardId },
      select: {
        ownerId: true,
        owner: { select: { email: true, name: true } },
      },
    }),
    prisma.boardMember.findMany({
      where: { boardId },
      orderBy: [{ role: "desc" }, { createdAt: "asc" }],
      select: {
        userId: true,
        role: true,
        user: { select: { email: true, name: true } },
      },
    }),
    prisma.boardShareLink.findMany({
      where: { boardId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tokenPrefix: true,
        role: true,
        createdAt: true,
        revokedAt: true,
        expiresAt: true,
      },
    }),
  ]);

  if (!board) return null;

  return {
    members: [
      {
        userId: board.ownerId,
        email: board.owner.email,
        name: board.owner.name,
        role: "OWNER",
        isYou: board.ownerId === userId,
      },
      ...members.map((member) => ({
        userId: member.userId,
        email: member.user.email,
        name: member.user.name,
        role: member.role,
        isYou: member.userId === userId,
      })),
    ],
    links,
  };
}
