import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Read helpers for the board view. Ownership is scoped to the session user so a
// board is only ever loaded for the account that owns it. Columns and cards are
// returned already ordered by their `position` Float (ascending = left-to-right
// for columns, top-to-bottom for cards) so the view renders them in order
// without sorting client-side.

export type BoardWithColumns = NonNullable<
  Awaited<ReturnType<typeof getCurrentUserBoard>>
>;
export type ColumnWithCards = BoardWithColumns["columns"][number];
export type BoardCard = ColumnWithCards["cards"][number];

/**
 * Load the signed-in user's board (their first, by creation order) with its
 * columns and cards ordered by `position`. Returns `null` when there is no
 * session or the user has no board yet (new signups) — the caller renders an
 * empty state that lets them create their first board.
 */
export async function getCurrentUserBoard() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  return prisma.board.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
    include: {
      columns: {
        orderBy: { position: "asc" },
        include: {
          cards: { orderBy: { position: "asc" } },
        },
      },
    },
  });
}
