import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { BoardView } from "@/components/board/board-view";
import { CreateBoardForm } from "@/components/board/create-board-form";
import { signOutAction } from "@/lib/actions/auth";
import { getCurrentUserBoard } from "@/lib/board";

// The board view. A protected route (see middleware.ts) rendered at "/", where
// login/signup redirect on success. This server component fetches the signed-in
// user's board (columns and cards already in `position` order) and hands it to
// the client <BoardView>, which renders the columns/cards and owns the @dnd-kit
// drag-drop reordering. Presentation follows the "Calm Focus" direction; the hue
// mapping lives alongside the board rendering in board-view.tsx.

export default async function BoardPage() {
  const board = await getCurrentUserBoard();

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <BoardHeader boardName={board?.name ?? null} />
      {board ? <BoardView board={board} /> : <EmptyState />}
    </main>
  );
}

function BoardHeader({ boardName }: { boardName: string | null }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex flex-col">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          TestProject
        </span>
        <h1 className="text-base font-semibold tracking-tight">
          {boardName ?? "Your board"}
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <form action={signOutAction}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}

function EmptyState() {
  return (
    <section className="flex flex-1 items-center justify-center p-6">
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
    </section>
  );
}
