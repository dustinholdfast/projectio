"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui";
import { joinBoardViaLink } from "@/lib/actions/sharing";

/** The click that actually redeems the link. See the note in page.tsx. */
export function JoinForm({
  token,
  boardName,
}: {
  token: string;
  boardName: string;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string>();
  const [isPending, startTransition] = React.useTransition();

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        className="w-full"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await joinBoardViaLink({ token });
            if (result.status === "invalid") {
              // The link was valid when the page rendered, so this means it was
              // revoked or expired in between.
              setError("This link is no longer valid. Ask for a new one.");
              return;
            }
            router.replace(`/board/${result.boardId}`);
          })
        }
      >
        {isPending ? "Joining…" : `Join ${boardName}`}
      </Button>
    </div>
  );
}
