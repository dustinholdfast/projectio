import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for deleteCard under the membership model. Prisma and the session are
// mocked, but the *role check itself runs for real* — only the membership lookup
// is stubbed — so these assert the actual authorisation path rather than assuming
// it passes.
const { authMock, prismaMock, revalidateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    card: { findUnique: vi.fn(), deleteMany: vi.fn() },
    board: { findFirst: vi.fn() },
  },
  revalidateMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

import { deleteCard } from "@/lib/actions/card-details";

const USER = "u1";

/** What the card → board walk returns. */
const cardOnBoard = { column: { boardId: "b1" } };

function grant(role: "VIEWER" | "EDITOR" | "OWNER" | null) {
  prismaMock.board.findFirst.mockResolvedValue(
    role === null
      ? null
      : role === "OWNER"
        ? { ownerId: USER, members: [] }
        : { ownerId: "owner", members: [{ role }] },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue({ user: { id: USER } });
  prismaMock.card.findUnique.mockResolvedValue(cardOnBoard);
  grant("EDITOR");
});

describe("deleteCard", () => {
  it("deletes the card and revalidates both views", async () => {
    prismaMock.card.deleteMany.mockResolvedValue({ count: 1 });

    const result = await deleteCard({ cardId: "c1" });

    expect(result).toBeUndefined();
    expect(prismaMock.card.deleteMany).toHaveBeenCalledWith({
      where: { id: "c1" },
    });
    expect(revalidateMock).toHaveBeenCalledWith("/board/b1");
    expect(revalidateMock).toHaveBeenCalledWith("/");
  });

  it("lets an owner delete too", async () => {
    grant("OWNER");
    prismaMock.card.deleteMany.mockResolvedValue({ count: 1 });

    expect(await deleteCard({ cardId: "c1" })).toBeUndefined();
  });

  it("refuses a viewer — this is the whole point of read-only access", async () => {
    grant("VIEWER");

    const result = await deleteCard({ cardId: "c1" });

    expect(result).toEqual({ error: "You have view-only access to this board." });
    expect(prismaMock.card.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses a card on a board the user is not a member of", async () => {
    grant(null);

    const result = await deleteCard({ cardId: "c1" });

    // Phrased as a missing card, not a missing board: a non-member must not be
    // able to tell that someone else's card exists.
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

  it("reports not-found when the delete matched nothing", async () => {
    // The card vanished between the access check and the delete.
    prismaMock.card.deleteMany.mockResolvedValue({ count: 0 });

    const result = await deleteCard({ cardId: "c1" });

    expect(result).toEqual({ error: "Card not found." });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("refuses without a session, before any lookup", async () => {
    authMock.mockResolvedValue(null);

    const result = await deleteCard({ cardId: "c1" });

    expect(result).toEqual({
      error: "Your session has expired. Please sign in again.",
    });
    // Not even the card lookup: an unauthenticated caller should not cost a
    // database round trip to be turned away.
    expect(prismaMock.card.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.card.deleteMany).not.toHaveBeenCalled();
  });
});
