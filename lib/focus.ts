import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roleAtLeast, type BoardRole } from "@/lib/roles";
import { dayKeyOfDueDate } from "@/lib/due-status";
import {
  rankCards,
  workspaceStats,
  type Priority,
  type RankableCard,
  type WorkspaceStats,
} from "@/lib/importance";

// Loader for the Focus pane. One query walks every board the signed-in user
// can see (owned or shared) and flattens the cards so they can be ranked as a
// single queue. Membership is part of the query, same rule as getUserBoards:
// a board the user cannot see never enters the result.

export type BoardHue = "slate" | "blue" | "amber" | "green" | "rose" | "violet";

const BOARD_COLORS: BoardHue[] = [
  "slate",
  "blue",
  "amber",
  "green",
  "rose",
  "violet",
];

/** Stable colour for a board chip. Boards have no stored hue; this is display only. */
export function boardColor(id: string): BoardHue {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return BOARD_COLORS[hash % BOARD_COLORS.length];
}

export type FocusBoard = {
  id: string;
  name: string;
  color: BoardHue;
  role: BoardRole;
  canEdit: boolean;
};

/**
 * Ranked card, already serialised for the client component. Dates become
 * `YYYY-MM-DD` (or null) so hydration cannot disagree about timezone.
 */
export type FocusItem = {
  id: string;
  title: string;
  description: string | null;
  owner: string | null;
  category: string | null;
  priority: Priority | null;
  columnName: string;
  dueDate: string | null;
  board: FocusBoard;
  status: FocusItemStatus;
  score: number;
  reasons: string[];
  isBlocked: boolean;
  openBlockers: string[];
  daysUntilDue: number | null;
  blockingCount: number;
  checklist: { id: string; text: string; done: boolean }[];
  canEdit: boolean;
};

export type FocusItemStatus =
  | "overdue"
  | "dueNow"
  | "later"
  | "paused"
  | "completed";

export type FocusWorkspace = {
  boards: FocusBoard[];
  items: FocusItem[];
  stats: WorkspaceStats;
};

export async function getFocusWorkspace(): Promise<FocusWorkspace> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { boards: [], items: [], stats: emptyStats() };

  const boards = await prisma.board.findMany({
    where: {
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      ownerId: true,
      members: { where: { userId }, select: { role: true }, take: 1 },
      columns: {
        orderBy: { position: "asc" },
        select: {
          name: true,
          cards: {
            select: {
              id: true,
              title: true,
              description: true,
              owner: true,
              category: true,
              priority: true,
              dueDate: true,
              pausedAt: true,
              completedAt: true,
              checklist: {
                select: { id: true, text: true, done: true },
                orderBy: { position: "asc" },
              },
              blockedBy: {
                select: {
                  blocker: {
                    select: { title: true, completedAt: true },
                  },
                },
              },
              blocking: { select: { blocked: { select: { title: true } } } },
            },
          },
        },
      },
    },
  });

  const focusBoards: FocusBoard[] = boards.map((board) => {
    const role: BoardRole =
      board.ownerId === userId ? "OWNER" : (board.members[0]?.role ?? "VIEWER");
    return {
      id: board.id,
      name: board.name,
      color: boardColor(board.id),
      role,
      canEdit: roleAtLeast(role, "EDITOR"),
    };
  });
  const byId = new Map(focusBoards.map((board) => [board.id, board]));

  const rankable: (RankableCard & {
    boardId: string;
    description: string | null;
    owner: string | null;
    category: string | null;
    checklist: { id: string; text: string; done: boolean }[];
  })[] = [];

  for (const board of boards) {
    for (const column of board.columns) {
      for (const card of column.cards) {
        rankable.push({
          id: card.id,
          title: card.title,
          description: card.description,
          owner: card.owner,
          category: card.category,
          dueDate: card.dueDate,
          pausedAt: card.pausedAt,
          completedAt: card.completedAt,
          priority: card.priority,
          columnName: column.name,
          blockedBy: card.blockedBy.map((link) => ({
            title: link.blocker.title,
            completed: link.blocker.completedAt !== null,
          })),
          blocking: card.blocking.map((link) => ({ title: link.blocked.title })),
          boardId: board.id,
          checklist: card.checklist,
        });
      }
    }
  }

  const now = new Date();
  const ranked = rankCards(rankable, now);
  const extras = new Map(rankable.map((card) => [card.id, card]));

  const items: FocusItem[] = ranked.map((card) => {
    const extra = extras.get(card.id)!;
    const board = byId.get(extra.boardId)!;
    return {
      id: card.id,
      title: card.title,
      description: extra.description,
      owner: extra.owner,
      category: extra.category,
      priority: card.priority,
      columnName: card.columnName,
      dueDate: card.dueDate ? dayKeyOfDueDate(card.dueDate) : null,
      board,
      status: card.status,
      score: card.score,
      reasons: card.reasons,
      isBlocked: card.isBlocked,
      openBlockers: card.openBlockers.map((blocker) => blocker.title),
      daysUntilDue: card.daysUntilDue,
      blockingCount: card.blocking.length,
      checklist: extra.checklist,
      canEdit: board.canEdit,
    };
  });

  return {
    boards: focusBoards,
    items,
    stats: workspaceStats(ranked),
  };
}

function emptyStats(): WorkspaceStats {
  return {
    overdue: 0,
    dueToday: 0,
    thisWeek: 0,
    blocked: 0,
    open: 0,
    parked: 0,
    done: 0,
  };
}
