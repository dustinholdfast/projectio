"use client";

import * as React from "react";

import { Button, Input } from "@/components/ui";
import { createColumn } from "@/lib/actions/board";

/**
 * Trailing "add a column" affordance, rendered after the last column. Collapsed
 * to a button until opened; on submit it calls the `createColumn` server action.
 * Structure/behavior only — the restyle card owns final presentation.
 */
export function AddColumnForm({ boardId }: { boardId: string }) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [isPending, startTransition] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <Button
        variant="outline"
        className="w-72 shrink-0 justify-start text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        + Add a column
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createColumn(undefined, formData);
          if (result?.error) {
            setError(result.error);
            return;
          }
          setError(undefined);
          setOpen(false);
        });
      }}
    >
      <input type="hidden" name="boardId" value={boardId} />
      <Input
        ref={inputRef}
        name="name"
        placeholder="Column name"
        aria-label="Column name"
        disabled={isPending}
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Adding…" : "Add column"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setError(undefined);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
