import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roleOfUser, ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/authz";
import { hashShareToken, isPlausibleShareToken } from "@/lib/share-token";
import { AuthShell } from "@/components/auth-shell";
import { JoinForm } from "./join-form";

// Redeeming a share link.
//
// Joining happens on a click, never on load. A route that granted access merely
// by being fetched could be triggered by a link preview, a chat client unfurling
// the URL, or a browser prefetch — none of which are the person deciding to join.
//
// The page is public so the link works before signing in; the guard below sends
// anyone without a session to log in and back again, so the URL survives signup.

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const link = isPlausibleShareToken(token)
    ? await prisma.boardShareLink.findUnique({
        where: { tokenHash: hashShareToken(token) },
        select: {
          role: true,
          revokedAt: true,
          expiresAt: true,
          board: { select: { id: true, name: true } },
        },
      })
    : null;

  const expired = Boolean(
    link && link.expiresAt.getTime() <= Date.now(),
  );
  // Unknown, revoked and expired all render the same thing: a probe should not
  // be able to tell a token that never existed from one that has been turned off,
  // and neither should reveal the board's name.
  if (!link || link.revokedAt || expired) {
    return (
      <AuthShell
        eyebrow="Shared board"
        title="This link is not valid"
        description="It may have been revoked, expired, or never existed."
        footer={
          <p className="text-sm text-muted-foreground">
            <Link href="/" className="font-medium text-primary hover:underline">
              Go to your boards
            </Link>
          </p>
        }
      >
        <p role="alert" className="text-sm text-destructive">
          Ask whoever shared it with you for a new link.
        </p>
      </AuthShell>
    );
  }

  const session = await auth();
  const userId = session?.user?.id;

  // Not signed in: bounce through login, returning here afterwards so the link
  // still works for someone who has to create an account first.
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/join/${token}`)}`);
  }

  // Already has access — nothing to decide, so skip the prompt entirely.
  const existingRole = await roleOfUser(link.board.id, userId);
  if (existingRole) redirect(`/board/${link.board.id}`);

  return (
    <AuthShell
      eyebrow="Shared board"
      title={`Join “${link.board.name}”`}
      description={`You have been invited as a ${ROLE_LABEL[link.role].toLowerCase()}.`}
      footer={
        <p className="text-sm text-muted-foreground">
          Not you?{" "}
          <Link href="/" className="font-medium text-primary hover:underline">
            Go to your boards
          </Link>
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {ROLE_DESCRIPTION[link.role]}
        </p>
        <JoinForm token={token} boardName={link.board.name} />
      </div>
    </AuthShell>
  );
}
