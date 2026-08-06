import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, txMock, revalidateMock } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    board: { findFirst: vi.fn() },
    boardMember: { upsert: vi.fn() },
  };
  return {
    authMock: vi.fn(),
    txMock: tx,
    prismaMock: {
      boardShareLink: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    },
    revalidateMock: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  isShareableRole: (value: string) => value === "VIEWER" || value === "EDITOR",
  requireBoardAccess: vi.fn(async () => ({
    ok: true,
    userId: "owner",
    role: "OWNER",
  })),
}));

import {
  createShareLink,
  joinBoardViaLink,
  revokeShareLink,
} from "@/lib/actions/sharing";
import { hashShareToken, isPlausibleShareToken } from "@/lib/share-token";

function createForm(expirationDays = "7"): FormData {
  const data = new FormData();
  data.set("boardId", "b1");
  data.set("role", "EDITOR");
  data.set("expirationDays", expirationDays);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "guest" } });
  prismaMock.boardShareLink.create.mockResolvedValue({});
  prismaMock.boardShareLink.updateMany.mockResolvedValue({ count: 1 });
  txMock.board.findFirst.mockResolvedValue(null);
  txMock.boardMember.upsert.mockResolvedValue({});
});

describe("createShareLink", () => {
  it("stores a digest and returns the raw token once with a default expiry", async () => {
    const before = Date.now();
    const result = await createShareLink(undefined, createForm());
    if (!result || !("created" in result)) throw new Error("link was not created");

    expect(isPlausibleShareToken(result.created.token)).toBe(true);
    expect(prismaMock.boardShareLink.create).toHaveBeenCalledWith({
      data: {
        boardId: "b1",
        role: "EDITOR",
        tokenHash: hashShareToken(result.created.token),
        tokenPrefix: result.created.token.slice(0, 8),
        expiresAt: expect.any(Date),
      },
    });
    const stored = prismaMock.boardShareLink.create.mock.calls[0][0].data;
    expect(stored).not.toHaveProperty("token");
    expect(new Date(result.created.expiresAt).getTime()).toBeGreaterThanOrEqual(
      before + 7 * 24 * 60 * 60 * 1000,
    );
  });

  it("rejects an arbitrary expiration", async () => {
    expect(await createShareLink(undefined, createForm("3650"))).toEqual({
      error: "A link can last 1, 7, or 30 days.",
    });
    expect(prismaMock.boardShareLink.create).not.toHaveBeenCalled();
  });
});

describe("joinBoardViaLink", () => {
  it("locks the digest row through membership creation", async () => {
    const token = "a".repeat(43);
    txMock.$queryRaw.mockResolvedValue([
      {
        boardId: "b1",
        role: "EDITOR",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);

    await expect(joinBoardViaLink({ token })).resolves.toEqual({
      status: "joined",
      boardId: "b1",
      role: "EDITOR",
    });

    const sql = Array.from(txMock.$queryRaw.mock.calls[0][0]).join("?");
    expect(sql).toContain('WHERE "tokenHash" =');
    expect(sql).toContain("FOR UPDATE");
    expect(txMock.$queryRaw.mock.calls[0][1]).toBe(hashShareToken(token));
    expect(txMock.boardMember.upsert).toHaveBeenCalledWith({
      where: { boardId_userId: { boardId: "b1", userId: "guest" } },
      update: {},
      create: { boardId: "b1", userId: "guest", role: "EDITOR" },
    });
  });

  it("refuses an expired row while it is locked", async () => {
    txMock.$queryRaw.mockResolvedValue([
      {
        boardId: "b1",
        role: "VIEWER",
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1),
      },
    ]);

    expect(await joinBoardViaLink({ token: "b".repeat(43) })).toEqual({
      status: "invalid",
    });
    expect(txMock.boardMember.upsert).not.toHaveBeenCalled();
  });
});

describe("revokeShareLink", () => {
  it("updates only an active link after owner authorization", async () => {
    prismaMock.boardShareLink.findUnique.mockResolvedValue({ boardId: "b1" });

    expect(await revokeShareLink({ linkId: "link1" })).toBeUndefined();
    expect(prismaMock.boardShareLink.updateMany).toHaveBeenCalledWith({
      where: { id: "link1", boardId: "b1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
