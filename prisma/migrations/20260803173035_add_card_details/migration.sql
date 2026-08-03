-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "category" TEXT,
ADD COLUMN     "completedAt" DATE,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "owner" TEXT,
ADD COLUMN     "priority" "Priority",
ADD COLUMN     "startedAt" DATE;

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardBlock" (
    "blockedId" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardBlock_pkey" PRIMARY KEY ("blockedId","blockerId")
);

-- CreateIndex
CREATE INDEX "ChecklistItem_cardId_position_idx" ON "ChecklistItem"("cardId", "position");

-- CreateIndex
CREATE INDEX "CardBlock_blockerId_idx" ON "CardBlock"("blockerId");

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardBlock" ADD CONSTRAINT "CardBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardBlock" ADD CONSTRAINT "CardBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
