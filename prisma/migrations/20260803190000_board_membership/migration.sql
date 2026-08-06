-- Add collaborator membership and share links without changing Board.ownerId.
--
-- This is deliberately additive: the currently deployed app can continue
-- reading ownerId while new instances begin using memberships. Board.ownerId
-- remains the sole source of truth for ownership and its foreign key guarantees
-- every board has exactly one owner.

-- 1. Roles, least to most privileged. OWNER is part of the application role
-- vocabulary, but collaborator and share-link rows are limited to VIEWER/EDITOR
-- by CHECK constraints below.
CREATE TYPE "BoardRole" AS ENUM ('VIEWER', 'EDITOR', 'OWNER');

-- 2. Collaborator membership. The composite primary key also indexes boardId;
-- userId gets its own index for the "boards shared with me" lookup and cascade.
CREATE TABLE "BoardMember" (
    "boardId"   TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "role"      "BoardRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardMember_pkey" PRIMARY KEY ("boardId", "userId"),
    CONSTRAINT "BoardMember_role_check" CHECK ("role" <> 'OWNER')
);

CREATE INDEX "BoardMember_userId_idx" ON "BoardMember"("userId");

ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_boardId_fkey"
    FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Revocable capability links. They may grant collaborator roles only.
CREATE TABLE "BoardShareLink" (
    "id"        TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "boardId"   TEXT NOT NULL,
    "role"      "BoardRole" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardShareLink_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BoardShareLink_role_check" CHECK ("role" <> 'OWNER'),
    CONSTRAINT "BoardShareLink_hash_check" CHECK (char_length("tokenHash") = 64),
    CONSTRAINT "BoardShareLink_prefix_check" CHECK (char_length("tokenPrefix") = 8)
);

CREATE UNIQUE INDEX "BoardShareLink_tokenHash_key" ON "BoardShareLink"("tokenHash");
CREATE INDEX "BoardShareLink_boardId_idx" ON "BoardShareLink"("boardId");

ALTER TABLE "BoardShareLink" ADD CONSTRAINT "BoardShareLink_boardId_fkey"
    FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Both new public tables get RLS. The application connects through Prisma as
-- the owning database role and keeps authorization in server actions; no Data
-- API policies or grants are introduced here.
ALTER TABLE "BoardMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BoardShareLink" ENABLE ROW LEVEL SECURITY;
