import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { AppHeader } from "@/components/app-header";
import { CreateBoardForm } from "@/components/board/create-board-form";
import { getUserBoards, type BoardSummary } from "@/lib/board";

// The board list. Used to live at `/`; Focus took that slot so this moved to
// `/boards`. Same data, same tiles — only the URL changed.

export default async function BoardsPage() {
  const boards = await getUserBoards();

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <AppHeader
        title="Your boards"
        subtitle={
          boards.length
            ? `${boards.length} board${boards.length === 1 ? "" : "s"}`
            : undefined
        }
        active="boards"
      />

      <section className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6">
        {boards.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-8">
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {boards.map((board) => (
                <li key={board.id}>
                  <BoardTile board={board} />
                </li>
              ))}
            </ul>

            <Card className="w-full max-w-sm shadow-md">
              <CardHeader className="gap-1 p-6 pb-4">
                <CardTitle className="text-base">New board</CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0">
                <CreateBoardForm />
              </CardContent>
            </Card>
          </div>
        )}
      </section>
    </main>
  );
}

function BoardTile({ board }: { board: BoardSummary }) {
  return (
    <Link
      href={`/board/${board.id}`}
      data-testid="board-tile"
      data-board-name={board.name}
      className="block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card className="h-full shadow-sm transition-shadow hover:shadow-md">
        <CardHeader className="gap-1 p-5 pb-3">
          <CardTitle className="truncate text-base">{board.name}</CardTitle>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <p className="text-sm text-muted-foreground">
            {board.columnCount} column{board.columnCount === 1 ? "" : "s"} ·{" "}
            {board.cardCount} card{board.cardCount === 1 ? "" : "s"}
            {board.memberCount > 1 ? ` · ${board.memberCount} people` : ""}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <Card className="w-full max-w-sm shadow-md">
        <CardHeader className="gap-2 p-6 pb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Get started
          </span>
          <CardTitle className="text-xl">Create your first board</CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          <CreateBoardForm />
        </CardContent>
      </Card>
    </div>
  );
}
