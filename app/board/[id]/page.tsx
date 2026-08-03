import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { BoardView } from "@/components/board/board-view";
import { BoardSettings } from "@/components/board/board-settings";
import { GroupToggle } from "@/components/board/group-toggle";
import { getBoardForUser } from "@/lib/board";

// A single board. Protected by middleware; ownership is enforced by the query in
// getBoardForUser, so a board belonging to someone else 404s exactly as an
// unknown id does — the page never confirms that another account's board exists.
//
// The server component fetches columns and cards already in `position` order and
// hands them to the client <BoardView>, which owns the @dnd-kit drag-drop
// reordering. `?group=due` swaps the columns for the derived schedule lanes.

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const [{ id }, { group }] = await Promise.all([params, searchParams]);
  const board = await getBoardForUser(id);

  if (!board) notFound();

  // Anything other than an explicit "due" falls back to columns, so a mangled
  // URL degrades to the normal board rather than an error.
  const groupBy = group === "due" ? "due" : "column";
  const cardCount = board.columns.reduce((sum, c) => sum + c.cards.length, 0);

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <AppHeader
        title={board.name}
        subtitle={`${board.columns.length} column${
          board.columns.length === 1 ? "" : "s"
        } · ${cardCount} card${cardCount === 1 ? "" : "s"}`}
        actions={
          <>
            <GroupToggle boardId={board.id} active={groupBy} />
            <BoardSettings boardId={board.id} boardName={board.name} />
          </>
        }
      />
      <BoardView board={board} groupBy={groupBy} />
    </main>
  );
}
