"use client";

import * as React from "react";

import { Button, Input } from "@/components/ui";
import { deleteBoard, renameBoard } from "@/lib/actions/board";

/**
 * Per-board controls in the header: rename inline, or delete.
 *
 * Deleting is irreversible and takes every column and card with it (the schema
 * cascades), so it sits behind a two-step confirm that names the board — a
 * single misplaced click should not be able to destroy one.
 *
 * Follows the same `useTransition` shape as the column/card editors: the form
 * closes only once the action returns without an error, so a rejected rename
 * keeps the editor open with its message.
 */
export function BoardSettings({
  boardId,
  boardName,
}: {
  boardId: string;
  boardName: string;
}) {
  const [mode, setMode] = React.useState<"idle" | "renaming" | "confirming">(
    "idle",
  );
  const [error, setError] = React.useState<string>();
  const [isPending, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (mode === "renaming") inputRef.current?.focus();
  }, [mode]);

  function close() {
    setMode("idle");
    setError(undefined);
  }

  if (mode === "renaming") {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(async () => {
            const result = await renameBoard(undefined, formData);
            if (result?.error) {
              setError(result.error);
              return;
            }
            close();
          });
        }}
      >
        <input type="hidden" name="boardId" value={boardId} />
        <Input
          ref={inputRef}
          name="name"
          defaultValue={boardName}
          aria-label="Board name"
          maxLength={80}
          disabled={isPending}
          className="h-9 w-56"
        />
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={close}
        >
          Cancel
        </Button>
      </form>
    );
  }

  if (mode === "confirming") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Delete “{boardName}” and everything on it?
        </span>
        {/* A plain action form: deleteBoard redirects to the list on success. */}
        <form action={deleteBoard}>
          <input type="hidden" name="boardId" value={boardId} />
          <Button type="submit" size="sm" variant="outline">
            Delete board
          </Button>
        </form>
        <Button type="button" size="sm" variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => setMode("renaming")}
      >
        Rename
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => setMode("confirming")}
      >
        Delete
      </Button>
    </div>
  );
}
