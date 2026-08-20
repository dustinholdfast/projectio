"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireBoardAccess } from "@/lib/authz";
import { POSITION_STEP } from "@/lib/reorder";
import { parseDueDate } from "@/lib/due-status";

// Actions that start from the Focus pane rather than a board. They reuse the
// same authorisation as every other card write — requireBoardAccess at EDITOR —
// and revalidate both the pane (`/`) and the board list (`/boards`).

export type FocusActionState = { error: string } | { id: string } | undefined;

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
type Priority = (typeof PRIORITIES)[number];

/**
 * Create a card on a board from the Focus composer.
 *
 * Lands in the board's leftmost column. Focus is a queue, not a board: it has
 * no column of its own, and inventing one would put the card somewhere the
 * user cannot find it later. The first column is the same place the board's
 * own "add card" form appends to when the board is empty of a choice.
 */
export async function createFocusCard(input: {
  boardId: string;
  title: string;
  dueDate?: string | null;
  priority?: string | null;
}): Promise<FocusActionState> {
  const access = await requireBoardAccess(input.boardId, "EDITOR");
  if (!access.ok) return { error: access.error };

  const title = input.title.trim().slice(0, 120);
  if (!title) return { error: "Enter a title." };

  const column = await prisma.column.findFirst({
    where: { boardId: input.boardId },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (!column) return { error: "That board has no columns to put a card in." };

  const last = await prisma.card.findFirst({
    where: { columnId: column.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const rawPriority = input.priority ?? "";
  const priority: Priority | null = PRIORITIES.includes(rawPriority as Priority)
    ? (rawPriority as Priority)
    : null;

  const dueRaw = (input.dueDate ?? "").trim();
  const dueDate = dueRaw ? parseDueDate(dueRaw) : null;
  if (dueRaw && !dueDate) return { error: "That is not a valid date." };

  const card = await prisma.card.create({
    data: {
      title,
      columnId: column.id,
      position: (last?.position ?? 0) + POSITION_STEP,
      dueDate,
      priority,
    },
    select: { id: true },
  });

  revalidatePath("/");
  revalidatePath("/boards");
  revalidatePath(`/board/${input.boardId}`);
  return { id: card.id };
}
