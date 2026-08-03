"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { POSITION_STEP } from "@/lib/reorder";
import { parseDueDate } from "@/lib/due-status";
import {
  BLOCK_REJECTION_MESSAGE,
  buildBlockGraph,
  checkBlockAllowed,
} from "@/lib/card-blocks";

// Server actions for the card detail dialog: the detail fields, the checklist,
// and the blocked-by graph.
//
// Same rule as every other action in this app — re-read the session, prove the
// target belongs to the current user by walking card → column → board → owner,
// and only then write. A forged id must never reach another account's data.

export type CardActionState = { error: string } | undefined;

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
type Priority = (typeof PRIORITIES)[number];

/** Caps, so a paste of a whole document cannot become a card field. */
const MAX_SHORT = 120;
const MAX_NOTES = 10_000;

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** The board a card belongs to, or null if the session user does not own it. */
async function ownedCardBoardId(
  cardId: string,
  userId: string,
): Promise<string | null> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: {
      column: { select: { boardId: true, board: { select: { ownerId: true } } } },
    },
  });
  if (!card || card.column.board.ownerId !== userId) return null;
  return card.column.boardId;
}

function revalidateBoard(boardId: string): void {
  revalidatePath(`/board/${boardId}`);
  revalidatePath("/");
}

/** Trim, cap, and treat blank as "cleared" rather than as an empty string. */
function optionalText(value: FormDataEntryValue | null, max: number): string | null {
  const text = String(value ?? "").trim().slice(0, max);
  return text.length > 0 ? text : null;
}

/** Save the detail fields. One action for the whole form: it submits as a unit. */
export async function updateCardDetails(
  _prevState: CardActionState,
  formData: FormData,
): Promise<CardActionState> {
  const userId = await requireUserId();
  if (!userId) return { error: "Your session has expired. Please sign in again." };

  const cardId = String(formData.get("cardId") ?? "");
  if (!cardId) return { error: "Missing card." };

  const boardId = await ownedCardBoardId(cardId, userId);
  if (!boardId) return { error: "Card not found." };

  const title = String(formData.get("title") ?? "").trim().slice(0, MAX_SHORT);
  if (!title) return { error: "A card needs a title." };

  const rawPriority = String(formData.get("priority") ?? "");
  const priority: Priority | null = PRIORITIES.includes(rawPriority as Priority)
    ? (rawPriority as Priority)
    : null;

  const startedRaw = String(formData.get("startedAt") ?? "").trim();
  const completedRaw = String(formData.get("completedAt") ?? "").trim();
  const dueRaw = String(formData.get("dueDate") ?? "").trim();

  const startedAt = startedRaw ? parseDueDate(startedRaw) : null;
  const completedAt = completedRaw ? parseDueDate(completedRaw) : null;
  const dueDate = dueRaw ? parseDueDate(dueRaw) : null;

  if (startedRaw && !startedAt) return { error: "Date started is not a valid date." };
  if (completedRaw && !completedAt) {
    return { error: "Date completed is not a valid date." };
  }
  if (dueRaw && !dueDate) return { error: "Due date is not a valid date." };

  // A card cannot finish before it starts. Worth rejecting rather than storing:
  // silently accepting it would corrupt any future cycle-time reporting, and the
  // usual cause is a typo the user can fix immediately.
  if (startedAt && completedAt && completedAt < startedAt) {
    return { error: "Date completed cannot be before date started." };
  }

  await prisma.card.update({
    where: { id: cardId },
    data: {
      title,
      description: optionalText(formData.get("description"), MAX_NOTES),
      owner: optionalText(formData.get("owner"), MAX_SHORT),
      category: optionalText(formData.get("category"), MAX_SHORT),
      notes: optionalText(formData.get("notes"), MAX_NOTES),
      priority,
      startedAt,
      completedAt,
      dueDate,
      // Completing a card un-pauses it: "parked" and "finished" are different
      // answers to "why is nobody working on this", and only one can be current.
      pausedAt: completedAt ? null : undefined,
    },
  });

  revalidateBoard(boardId);
}

// ── Checklist ────────────────────────────────────────────────────────────────

export async function addChecklistItem(input: {
  cardId: string;
  text: string;
}): Promise<CardActionState> {
  const userId = await requireUserId();
  if (!userId) return { error: "Your session has expired. Please sign in again." };

  const boardId = await ownedCardBoardId(input.cardId, userId);
  if (!boardId) return { error: "Card not found." };

  const text = input.text.trim().slice(0, MAX_SHORT);
  if (!text) return { error: "Enter something to add." };

  const last = await prisma.checklistItem.findFirst({
    where: { cardId: input.cardId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  await prisma.checklistItem.create({
    data: {
      cardId: input.cardId,
      text,
      position: (last?.position ?? 0) + POSITION_STEP,
    },
  });

  revalidateBoard(boardId);
}

export async function setChecklistItemDone(input: {
  itemId: string;
  done: boolean;
}): Promise<CardActionState> {
  const userId = await requireUserId();
  if (!userId) return { error: "Your session has expired. Please sign in again." };

  // Walk item → card → column → board → owner in one query.
  const item = await prisma.checklistItem.findUnique({
    where: { id: input.itemId },
    select: {
      card: {
        select: {
          column: {
            select: { boardId: true, board: { select: { ownerId: true } } },
          },
        },
      },
    },
  });
  if (!item || item.card.column.board.ownerId !== userId) {
    return { error: "Item not found." };
  }

  await prisma.checklistItem.update({
    where: { id: input.itemId },
    data: { done: input.done },
  });

  revalidateBoard(item.card.column.boardId);
}

export async function deleteChecklistItem(input: {
  itemId: string;
}): Promise<CardActionState> {
  const userId = await requireUserId();
  if (!userId) return { error: "Your session has expired. Please sign in again." };

  const item = await prisma.checklistItem.findUnique({
    where: { id: input.itemId },
    select: {
      card: {
        select: {
          column: {
            select: { boardId: true, board: { select: { ownerId: true } } },
          },
        },
      },
    },
  });
  if (!item || item.card.column.board.ownerId !== userId) {
    return { error: "Item not found." };
  }

  await prisma.checklistItem.delete({ where: { id: input.itemId } });

  revalidateBoard(item.card.column.boardId);
}

// ── Dependencies ─────────────────────────────────────────────────────────────

/**
 * Record that `blockedId` waits on `blockerId`.
 *
 * Rejects self-links, duplicates, cross-board links, and anything that would
 * close a cycle. The cycle check reads the board's whole dependency graph first:
 * it is the only way to catch a loop that closes through several hops, and a
 * board's worth of edges is small enough to load.
 */
export async function addCardBlocker(input: {
  blockedId: string;
  blockerId: string;
}): Promise<CardActionState> {
  const userId = await requireUserId();
  if (!userId) return { error: "Your session has expired. Please sign in again." };

  const boardId = await ownedCardBoardId(input.blockedId, userId);
  if (!boardId) return { error: "Card not found." };

  // The blocker must be on the same board — and checking it through the same
  // ownership walk means a blocker id from another account is rejected as
  // "not on this board" rather than confirming it exists.
  const blockerBoardId = await ownedCardBoardId(input.blockerId, userId);
  if (blockerBoardId !== boardId) {
    return { error: BLOCK_REJECTION_MESSAGE["cross-board"] };
  }

  const rows = await prisma.cardBlock.findMany({
    where: { blocked: { column: { boardId } } },
    select: { blockedId: true, blockerId: true },
  });

  const existing = rows
    .filter((row) => row.blockedId === input.blockedId)
    .map((row) => row.blockerId);

  const rejection = checkBlockAllowed(
    buildBlockGraph(rows),
    input.blockedId,
    input.blockerId,
    existing,
  );
  if (rejection) return { error: BLOCK_REJECTION_MESSAGE[rejection] };

  await prisma.cardBlock.create({
    data: { blockedId: input.blockedId, blockerId: input.blockerId },
  });

  revalidateBoard(boardId);
}

export async function removeCardBlocker(input: {
  blockedId: string;
  blockerId: string;
}): Promise<CardActionState> {
  const userId = await requireUserId();
  if (!userId) return { error: "Your session has expired. Please sign in again." };

  const boardId = await ownedCardBoardId(input.blockedId, userId);
  if (!boardId) return { error: "Card not found." };

  await prisma.cardBlock.deleteMany({
    where: { blockedId: input.blockedId, blockerId: input.blockerId },
  });

  revalidateBoard(boardId);
}
