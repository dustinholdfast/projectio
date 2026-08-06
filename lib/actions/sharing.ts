"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  type BoardRole,
  isShareableRole,
  requireBoardAccess,
} from "@/lib/authz";
import {
  createShareToken,
  hashShareToken,
  isPlausibleShareToken,
  shareTokenPrefix,
} from "@/lib/share-token";

// Sharing: share links, joining through one, and managing who has access.
//
// Everything that changes *who* can reach a board is owner-only. An editor can
// change the board's contents freely, but handing access to someone else is a
// different kind of decision and stays with the one person accountable for it.

export type CreatedShareLink = {
  token: string;
  tokenPrefix: string;
  role: BoardRole;
  expiresAt: string;
};

export type SharingActionState =
  | { error: string }
  | { created: CreatedShareLink }
  | undefined;
export type SharingMutationState = { error: string } | undefined;

const EXPIRATION_DAYS = new Set([1, 7, 30]);

function revalidateBoard(boardId: string): void {
  revalidatePath(`/board/${boardId}`);
  revalidatePath("/");
}

/**
 * Create a share link for a board.
 *
 * The role is restricted to VIEWER or EDITOR: a link that granted OWNER would
 * let anyone holding a URL delete the board and evict the person who made it.
 */
export async function createShareLink(
  _prevState: SharingActionState,
  formData: FormData,
): Promise<SharingActionState> {
  const boardId = String(formData.get("boardId") ?? "");
  const role = String(formData.get("role") ?? "");
  const expirationDays = Number(formData.get("expirationDays") ?? 7);
  if (!boardId) return { error: "Missing board." };
  if (!isShareableRole(role)) {
    return { error: "A link can grant view or edit access only." };
  }
  if (!EXPIRATION_DAYS.has(expirationDays)) {
    return { error: "A link can last 1, 7, or 30 days." };
  }

  const access = await requireBoardAccess(boardId, "OWNER");
  if (!access.ok) return { error: access.error };

  const token = createShareToken();
  const tokenPrefix = shareTokenPrefix(token);
  const expiresAt = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000);

  await prisma.boardShareLink.create({
    data: {
      boardId,
      role: role as BoardRole,
      tokenHash: hashShareToken(token),
      tokenPrefix,
      expiresAt,
    },
  });

  revalidateBoard(boardId);
  return {
    created: {
      token,
      tokenPrefix,
      role: role as BoardRole,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/**
 * Turn a link off.
 *
 * This does **not** remove anyone who already used it: by then they hold a
 * membership of their own, and taking that away is a separate, deliberate act on
 * the members list. Conflating the two would make revoking a link feel like it
 * had failed, or silently evict people the owner meant to keep.
 */
export async function revokeShareLink(input: {
  linkId: string;
}): Promise<SharingMutationState> {
  const link = await prisma.boardShareLink.findUnique({
    where: { id: input.linkId },
    select: { boardId: true },
  });
  if (!link) return { error: "Link not found." };

  const access = await requireBoardAccess(link.boardId, "OWNER");
  if (!access.ok) return { error: access.error };

  // An UPDATE takes a row lock. If redemption currently holds the same link's
  // FOR UPDATE lock, revocation waits; if revocation wins first, redemption sees
  // revokedAt and refuses. There is no read-valid/write-after-revoke window.
  await prisma.boardShareLink.updateMany({
    where: { id: input.linkId, boardId: link.boardId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  revalidateBoard(link.boardId);
}

export type JoinOutcome =
  | { status: "joined"; boardId: string; role: BoardRole }
  | { status: "already-member"; boardId: string }
  | { status: "invalid" };

/**
 * Redeem a share link.
 *
 * Deliberately an action rather than something that happens on page load: a link
 * that granted access merely by being fetched could be triggered by a preview
 * crawler, a chat client unfurling a URL, or a browser prefetch. Joining is a
 * decision, so it takes a click.
 *
 * An existing member keeps the role they already have — a VIEWER link must never
 * downgrade an editor, and an EDITOR link must not silently promote past what the
 * owner set on the members list.
 */
export async function joinBoardViaLink(input: {
  token: string;
}): Promise<JoinOutcome> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { status: "invalid" };
  if (!isPlausibleShareToken(input.token)) return { status: "invalid" };

  const tokenHash = hashShareToken(input.token);
  const outcome = await prisma.$transaction(async (tx) => {
    // Lock only the one indexed link row, and hold it only through the local
    // membership lookup/upsert. Revocation updates the same row, so these two
    // decisions cannot pass each other in flight.
    const rows = await tx.$queryRaw<
      {
        boardId: string;
        role: string;
        revokedAt: Date | null;
        expiresAt: Date;
      }[]
    >`
      SELECT "boardId", "role"::text AS "role", "revokedAt", "expiresAt"
      FROM "BoardShareLink"
      WHERE "tokenHash" = ${tokenHash}
      FOR UPDATE
    `;
    const link = rows[0];

    // Unknown, revoked, expired, and malformed-role rows are one result. A probe
    // cannot use the response to learn which kind of dead capability it found.
    if (
      !link ||
      link.revokedAt ||
      link.expiresAt.getTime() <= Date.now() ||
      !isShareableRole(link.role)
    ) {
      return { status: "invalid" } as const;
    }

    const existing = await tx.board.findFirst({
      where: {
        id: link.boardId,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      select: { id: true },
    });
    if (existing) {
      return { status: "already-member", boardId: link.boardId } as const;
    }

    // Upsert closes the double-click/two-tab race. An empty update preserves any
    // role an owner granted concurrently rather than downgrading it to the link.
    await tx.boardMember.upsert({
      where: { boardId_userId: { boardId: link.boardId, userId } },
      update: {},
      create: { boardId: link.boardId, userId, role: link.role },
    });

    return {
      status: "joined",
      boardId: link.boardId,
      role: link.role,
    } as const;
  });

  if (outcome.status === "joined") revalidateBoard(outcome.boardId);
  return outcome;
}

/** Change a member's role. Owner only, and the owner's own row is immovable. */
export async function setMemberRole(input: {
  boardId: string;
  userId: string;
  role: BoardRole;
}): Promise<SharingMutationState> {
  const access = await requireBoardAccess(input.boardId, "OWNER");
  if (!access.ok) return { error: access.error };

  if (input.userId === access.userId) {
    // Guarding the last OWNER. Without this an owner could demote themselves and
    // leave the board with nobody able to share or delete it — recoverable only
    // by editing the database.
    return { error: "You cannot change your own role as owner." };
  }
  if (!isShareableRole(input.role)) {
    return { error: "Members can be viewers or editors." };
  }

  const result = await prisma.boardMember.updateMany({
    where: { boardId: input.boardId, userId: input.userId, role: { not: "OWNER" } },
    data: { role: input.role },
  });
  if (result.count === 0) return { error: "Member not found." };

  revalidateBoard(input.boardId);
}

/** Remove someone's access. Owner only; the owner cannot remove themselves. */
export async function removeMember(input: {
  boardId: string;
  userId: string;
}): Promise<SharingMutationState> {
  const access = await requireBoardAccess(input.boardId, "OWNER");
  if (!access.ok) return { error: access.error };

  if (input.userId === access.userId) {
    return { error: "You cannot remove yourself as owner. Delete the board instead." };
  }

  const result = await prisma.boardMember.deleteMany({
    where: { boardId: input.boardId, userId: input.userId, role: { not: "OWNER" } },
  });
  if (result.count === 0) return { error: "Member not found." };

  revalidateBoard(input.boardId);
}

/**
 * Leave a board you were given access to.
 *
 * Available to everyone except the owner, who has no board to go back to — for
 * them the equivalent is deleting it.
 */
export async function leaveBoard(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId") ?? "");
  if (boardId) {
    const access = await requireBoardAccess(boardId, "VIEWER");
    if (access.ok && access.role !== "OWNER") {
      await prisma.boardMember.deleteMany({
        where: { boardId, userId: access.userId },
      });
    }
  }

  revalidatePath("/");
  redirect("/");
}
