import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for deleteCard. Prisma and the session are mocked so the ownership
// scoping can be asserted without a database — the property that matters is that
// a forged card id cannot delete another account's card.
const { authMock, prismaMock, revalidateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    card: { findUnique: vi.fn(), deleteMany: vi.fn() },
  },
  revalidateMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

import { deleteCard } from "@/lib/actions/card-details";

const USER = "u1";

/** What the ownership walk returns for a card the session user owns. */
const ownedCard = {
  column: { boardId: "b1", board: { ownerId: USER } },
};

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue({ user: { id: USER } });
});

describe("deleteCard", () => {
  it("deletes the card and revalidates both views", async () => {
    prismaMock.card.findUnique.mockResolvedValue(ownedCard);
    prismaMock.card.deleteMany.mockResolvedValue({ count: 1 });

    const result = await deleteCard({ cardId: "c1" });

    expect(result).toBeUndefined();
    expect(revalidateMock).toHaveBeenCalledWith("/board/b1");
    expect(revalidateMock).toHaveBeenCalledWith("/");
  });

  it("scopes the delete by owner, not just the prior lookup", async () => {
    prismaMock.card.findUnique.mockResolvedValue(ownedCard);
    prismaMock.card.deleteMany.mockResolvedValue({ count: 1 });

    await deleteCard({ cardId: "c1" });

    // The ownership filter must be part of the delete itself: a check that only
    // happened beforehand could go stale between the two queries.
    expect(prismaMock.card.deleteMany).toHaveBeenCalledWith({
      where: { id: "c1", column: { board: { ownerId: USER } } },
    });
  });

  it("refuses a card owned by someone else", async () => {
    prismaMock.card.findUnique.mockResolvedValue({
      column: { boardId: "b1", board: { ownerId: "someone-else" } },
    });

    const result = await deleteCard({ cardId: "c1" });

    expect(result).toEqual({ error: "Card not found." });
    expect(prismaMock.card.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses an unknown card", async () => {
    prismaMock.card.findUnique.mockResolvedValue(null);

    expect(await deleteCard({ cardId: "nope" })).toEqual({
      error: "Card not found.",
    });
    expect(prismaMock.card.deleteMany).not.toHaveBeenCalled();
  });

  it("reports not-found when the scoped delete matched nothing", async () => {
    // The card vanished between the lookup and the delete.
    prismaMock.card.findUnique.mockResolvedValue(ownedCard);
    prismaMock.card.deleteMany.mockResolvedValue({ count: 0 });

    const result = await deleteCard({ cardId: "c1" });

    expect(result).toEqual({ error: "Card not found." });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("refuses without a session and touches nothing", async () => {
    authMock.mockResolvedValue(null);

    const result = await deleteCard({ cardId: "c1" });

    expect(result).toEqual({
      error: "Your session has expired. Please sign in again.",
    });
    expect(prismaMock.card.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.card.deleteMany).not.toHaveBeenCalled();
  });
});
