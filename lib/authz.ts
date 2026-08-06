import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { type BoardRole, roleAtLeast } from "@/lib/roles";

// Re-exported so server code has one import for both the vocabulary and the
// checks. Client components must import from "@/lib/roles" directly — this
// module reaches the database and cannot be bundled for the browser.
export {
  type BoardRole,
  roleAtLeast,
  SHAREABLE_ROLES,
  isShareableRole,
  ROLE_LABEL,
  ROLE_DESCRIPTION,
} from "@/lib/roles";

// Board authorisation, in one place.
//
// Before sharing, every check was "is this board's ownerId you?" — inlined at
// each call site. With three roles that pattern stops being safe: each site would
// carry its own idea of which roles may write, and the one that gets it wrong is
// a viewer silently editing someone else's board. So the rank comparison lives
// here, and actions state a *minimum role* rather than a list of allowed ones.
//
// The rank ordering is the reason adding a role later does not mean re-auditing
// every call site: a new role slots into the ranking and existing checks keep
// meaning what they said.

/**
 * The signed-in user's role on a board, or null if they have none.
 *
 * Null covers "no session", "board does not exist" and "not a member" without
 * distinguishing them — callers 404 on all three, so a probe cannot use the
 * response to discover that someone else's board exists.
 */
export async function boardRoleOf(boardId: string): Promise<BoardRole | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return roleOfUser(boardId, userId);
}

/** As `boardRoleOf`, for a user id already in hand. */
export async function roleOfUser(
  boardId: string,
  userId: string,
): Promise<BoardRole | null> {
  // Scope the lookup to boards the user can reach, so an inaccessible board and
  // a missing board remain indistinguishable. Ownership is canonical on Board;
  // BoardMember contains collaborators only.
  const board = await prisma.board.findFirst({
    where: {
      id: boardId,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    select: {
      ownerId: true,
      members: { where: { userId }, select: { role: true }, take: 1 },
    },
  });
  if (!board) return null;
  return board.ownerId === userId ? "OWNER" : (board.members[0]?.role ?? null);
}

export type AccessGrant =
  | { ok: true; userId: string; role: BoardRole }
  | { ok: false; error: string };

/**
 * Require at least `minimum` on `boardId`, for use at the top of a server action.
 *
 * Two failure messages, deliberately different:
 *   • no membership at all → "Board not found", which does not confirm the board
 *     exists to someone who cannot see it;
 *   • a member whose role is too low → says so plainly, because hiding it from
 *     someone who can see the board would just be confusing.
 */
export async function requireBoardAccess(
  boardId: string,
  minimum: BoardRole,
): Promise<AccessGrant> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  return accessFor(userId, boardId, minimum);
}

/** The role decision, once the caller already knows who is asking. */
async function accessFor(
  userId: string,
  boardId: string,
  minimum: BoardRole,
): Promise<AccessGrant> {
  const role = await roleOfUser(boardId, userId);
  if (!role) return { ok: false, error: "Board not found." };

  if (!roleAtLeast(role, minimum)) {
    return {
      ok: false,
      error:
        minimum === "OWNER"
          ? "Only the board owner can do that."
          : "You have view-only access to this board.",
    };
  }

  return { ok: true, userId, role };
}

/**
 * The same check, starting from a card rather than a board.
 *
 * Every card-level action needs the card's board before it can decide anything,
 * and doing that walk by hand at each site is how one of them ends up checking
 * the wrong thing. Returns the board id too, since callers revalidate with it.
 */
export async function requireCardAccess(
  cardId: string,
  minimum: BoardRole,
): Promise<(AccessGrant & { ok: true; boardId: string }) | { ok: false; error: string }> {
  // Session first, before any lookup: an unauthenticated caller should be told
  // so rather than being told the card does not exist, and should not cost a
  // database round trip to find that out.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { column: { select: { boardId: true } } },
  });
  if (!card) return { ok: false, error: "Card not found." };

  const boardId = card.column.boardId;
  const grant = await accessFor(userId, boardId, minimum);
  if (!grant.ok) {
    // Re-word so a non-member gets the card-level phrasing they expect, rather
    // than being told a *board* they cannot see does not exist.
    return grant.error === "Board not found."
      ? { ok: false, error: "Card not found." }
      : grant;
  }

  return { ...grant, boardId };
}

/** As `requireCardAccess`, starting from a column. */
export async function requireColumnAccess(
  columnId: string,
  minimum: BoardRole,
): Promise<(AccessGrant & { ok: true; boardId: string }) | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }

  const column = await prisma.column.findUnique({
    where: { id: columnId },
    select: { boardId: true },
  });
  if (!column) return { ok: false, error: "Column not found." };

  const grant = await accessFor(userId, column.boardId, minimum);
  if (!grant.ok) {
    return grant.error === "Board not found."
      ? { ok: false, error: "Column not found." }
      : grant;
  }

  return { ...grant, boardId: column.boardId };
}
