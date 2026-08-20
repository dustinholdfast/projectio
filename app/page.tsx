import { AppHeader } from "@/components/app-header";
import { FocusView } from "@/components/focus/focus-view";
import { auth } from "@/lib/auth";
import { getFocusWorkspace } from "@/lib/focus";

// The Focus pane — the post-login landing. Every card the signed-in user can
// see, across every board they own or have been shared, ranked into one queue.
// Boards stay at /boards; this page is the decision, not the filing cabinet.

export default async function FocusPage() {
  const [workspace, session] = await Promise.all([
    getFocusWorkspace(),
    auth(),
  ]);

  const firstName =
    session?.user?.name?.split(" ")[0] ||
    session?.user?.email?.split("@")[0] ||
    "there";

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <AppHeader
        title="Focus"
        subtitle="What to do next, across every board"
        active="focus"
      />
      <FocusView workspace={workspace} firstName={firstName} />
    </main>
  );
}
