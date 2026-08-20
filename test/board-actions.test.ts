import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration tests for the board server actions. Prisma, the session, and the
// Next cache/navigation helpers are mocked so we can assert the ownership walk,
// cross-board rejection, neighbor scoping, and the single-row midpoint write
// without a real database.
const { authMock, prismaMock, revalidateMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    card: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    column: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    board: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
  revalidateMock: vi.fn(),
  // `redirect` throws in Next so control never returns; mirror that here or the
  // actions under test would carry on past it.
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import {
  deleteBoard,
  renameBoard,
  reorderCard,
  reorderColumn,
} from "@/lib/actions/board";

const USER = "u1";

/** Give the session user a role on every board these tests touch. */
function grant(role: "VIEWER" | "EDITOR" | "OWNER") {
  prismaMock.board.findFirst.mockResolvedValue(
    role === "OWNER"
      ? { ownerId: USER, members: [] }
      : { ownerId: "owner", members: [{ role }] },
  );
}

/** Build the FormData a board action receives from its form. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
  authMock.mockResolvedValue({ user: { id: USER } });
  grant("EDITOR");
  prismaMock.card.update.mockResolvedValue({});
  prismaMock.column.update.mockResolvedValue({});
});

describe("reorderCard", () => {
  function ownedCard(boardId = "b1") {
    return { column: { boardId } };
  }
  function ownedColumn(boardId = "b1") {
    return { boardId };
  }

  it("writes the midpoint of its two neighbors and revalidates", async () => {
    prismaMock.card.findUnique.mockResolvedValue(ownedCard());
    prismaMock.column.findUnique.mockResolvedValue(ownedColumn());
    prismaMock.card.findFirst
      .mockResolvedValueOnce({ position: 1000 }) // prev
      .mockResolvedValueOnce({ position: 2000 }); // next

    const result = await reorderCard({
      cardId: "cX",
      toColumnId: "col2",
      prevCardId: "cA",
      nextCardId: "cB",
    });

    expect(result).toBeUndefined();
    expect(prismaMock.card.update).toHaveBeenCalledWith({
      where: { id: "cX" },
      data: { columnId: "col2", position: 1500 },
    });
    // Both routes: the board itself, and the list, whose counts it feeds.
    expect(revalidateMock).toHaveBeenCalledWith("/board/b1");
    expect(revalidateMock).toHaveBeenCalledWith("/");
  });

  it("scopes neighbor lookups to the destination column so foreign ids can't skew the midpoint", async () => {
    prismaMock.card.findUnique.mockResolvedValue(ownedCard());
    prismaMock.column.findUnique.mockResolvedValue(ownedColumn());
    prismaMock.card.findFirst.mockResolvedValue({ position: 1000 });

    await reorderCard({
      cardId: "cX",
      toColumnId: "col2",
      prevCardId: "cA",
      nextCardId: null,
    });

    expect(prismaMock.card.findFirst).toHaveBeenCalledWith({
      where: { id: "cA", columnId: "col2" },
      select: { position: true },
    });
  });

  it("appends past the single neighbor when dropped at the end of a column", async () => {
    prismaMock.card.findUnique.mockResolvedValue(ownedCard());
    prismaMock.column.findUnique.mockResolvedValue(ownedColumn());
    prismaMock.card.findFirst.mockResolvedValueOnce({ position: 5000 }); // prev only

    await reorderCard({
      cardId: "cX",
      toColumnId: "col2",
      prevCardId: "cLast",
      nextCardId: null,
    });

    expect(prismaMock.card.update).toHaveBeenCalledWith({
      where: { id: "cX" },
      data: { columnId: "col2", position: 6000 },
    });
  });

  it("rejects a card on a board the user is not a member of", async () => {
    prismaMock.card.findUnique.mockResolvedValue(ownedCard());
    prismaMock.column.findUnique.mockResolvedValue(ownedColumn());
    prismaMock.board.findFirst.mockResolvedValue(null);

    const result = await reorderCard({
      cardId: "cX",
      toColumnId: "col2",
      prevCardId: null,
      nextCardId: null,
    });

    expect(result).toEqual({ error: "Card not found." });
    expect(prismaMock.card.update).not.toHaveBeenCalled();
  });

  it("rejects a move that would cross boards", async () => {
    prismaMock.card.findUnique.mockResolvedValue(ownedCard("b1"));
    prismaMock.column.findUnique.mockResolvedValue(ownedColumn("b2"));

    const result = await reorderCard({
      cardId: "cX",
      toColumnId: "col2",
      prevCardId: null,
      nextCardId: null,
    });

    expect(result).toEqual({ error: "Cards can only move within the same board." });
    expect(prismaMock.card.update).not.toHaveBeenCalled();
  });

  it("rejects when there is no session", async () => {
    authMock.mockResolvedValue(null);

    const result = await reorderCard({
      cardId: "cX",
      toColumnId: "col2",
      prevCardId: null,
      nextCardId: null,
    });

    expect(result).toEqual({
      error: "Your session has expired. Please sign in again.",
    });
    expect(prismaMock.card.findUnique).not.toHaveBeenCalled();
  });
});

describe("reorderColumn", () => {
  it("writes the midpoint of its neighbor columns", async () => {
    prismaMock.column.findUnique.mockResolvedValue({ boardId: "b1" });
    prismaMock.column.findFirst
      .mockResolvedValueOnce({ position: 2000 }) // prev
      .mockResolvedValueOnce({ position: 3000 }); // next

    const result = await reorderColumn({
      columnId: "colX",
      prevColumnId: "colA",
      nextColumnId: "colB",
    });

    expect(result).toBeUndefined();
    expect(prismaMock.column.update).toHaveBeenCalledWith({
      where: { id: "colX" },
      data: { position: 2500 },
    });
  });

  it("scopes neighbor lookups to the same board", async () => {
    prismaMock.column.findUnique.mockResolvedValue({ boardId: "b1" });
    prismaMock.column.findFirst.mockResolvedValue({ position: 2000 });

    await reorderColumn({
      columnId: "colX",
      prevColumnId: "colA",
      nextColumnId: null,
    });

    expect(prismaMock.column.findFirst).toHaveBeenCalledWith({
      where: { id: "colA", boardId: "b1" },
      select: { position: true },
    });
  });

  it("rejects a column on a board the user is not a member of", async () => {
    prismaMock.column.findUnique.mockResolvedValue({ boardId: "b1" });
    prismaMock.board.findFirst.mockResolvedValue(null);

    const result = await reorderColumn({
      columnId: "colX",
      prevColumnId: null,
      nextColumnId: null,
    });

    expect(result).toEqual({ error: "Column not found." });
    expect(prismaMock.column.update).not.toHaveBeenCalled();
  });
});

describe("renameBoard", () => {
  it("renames when the user owns the board", async () => {
    grant("OWNER");
    prismaMock.board.update.mockResolvedValue({});

    const result = await renameBoard(undefined, form({ boardId: "b1", name: "Q3 Plan" }));

    expect(result).toBeUndefined();
    expect(prismaMock.board.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { name: "Q3 Plan" },
    });
    expect(revalidateMock).toHaveBeenCalledWith("/board/b1");
  });

  it("refuses an editor, because renaming is an owner decision", async () => {
    grant("EDITOR");

    const result = await renameBoard(undefined, form({ boardId: "b1", name: "Mine now" }));

    expect(result).toEqual({ error: "Only the board owner can do that." });
    expect(prismaMock.board.update).not.toHaveBeenCalled();
  });

  it("reports not-found for a board the user cannot see", async () => {
    prismaMock.board.findFirst.mockResolvedValue(null);

    const result = await renameBoard(undefined, form({ boardId: "bX", name: "Mine now" }));

    expect(result).toEqual({ error: "Board not found." });
    expect(prismaMock.board.update).not.toHaveBeenCalled();
  });

  it("rejects a blank name without writing", async () => {
    const result = await renameBoard(undefined, form({ boardId: "b1", name: "   " }));

    expect(result).toEqual({ error: "Enter a name for your board." });
    expect(prismaMock.board.update).not.toHaveBeenCalled();
  });

  it("trims and caps an over-long name rather than rejecting it", async () => {
    grant("OWNER");
    prismaMock.board.update.mockResolvedValue({});

    await renameBoard(undefined, form({ boardId: "b1", name: `  ${"x".repeat(200)}  ` }));

    const { name } = prismaMock.board.update.mock.calls[0][0].data;
    expect(name).toHaveLength(80);
  });

  it("refuses without a session", async () => {
    authMock.mockResolvedValue(null);

    const result = await renameBoard(undefined, form({ boardId: "b1", name: "Nope" }));

    expect(result).toEqual({
      error: "Your session has expired. Please sign in again.",
    });
    expect(prismaMock.board.update).not.toHaveBeenCalled();
  });
});

describe("deleteBoard", () => {
  it("deletes when the user owns the board", async () => {
    grant("OWNER");
    prismaMock.board.delete.mockResolvedValue({});

    await expect(deleteBoard(form({ boardId: "b1" }))).rejects.toThrow(
      "NEXT_REDIRECT:/boards",
    );

    expect(prismaMock.board.delete).toHaveBeenCalledWith({ where: { id: "b1" } });
  });

  it("refuses an editor, and still redirects rather than erroring", async () => {
    // This action redirects rather than rendering, so there is nowhere to put a
    // message: a non-owner lands back on the list with the board intact.
    grant("EDITOR");

    await expect(deleteBoard(form({ boardId: "b1" }))).rejects.toThrow(
      "NEXT_REDIRECT:/boards",
    );

    expect(prismaMock.board.delete).not.toHaveBeenCalled();
  });

  it("deletes nothing for an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null);

    await expect(deleteBoard(form({ boardId: "b1" }))).rejects.toThrow(
      "NEXT_REDIRECT:/boards",
    );

    expect(prismaMock.board.delete).not.toHaveBeenCalled();
  });
});
