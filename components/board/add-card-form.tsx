"use client";

import * as React from "react";

import { Button, Input } from "@/components/ui";
import { createCard } from "@/lib/actions/board";

/**
 * Inline "add a card" editor at the foot of a column. Collapsed to a button
 * until opened; on submit it calls the `createCard` server action, then clears
 * and stays open so several cards can be added in a row. Structure/behavior
 * only — the restyle card owns final presentation.
 */
export function AddCardForm({ columnId }: { columnId: string }) {
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
        variant="ghost"
        size="sm"
        className="w-full justify-start text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        + Add a card
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createCard(undefined, formData);
          if (result?.error) {
            setError(result.error);
            return;
          }
          setError(undefined);
          formRef.current?.reset();
          inputRef.current?.focus();
        });
      }}
    >
      <input type="hidden" name="columnId" value={columnId} />
      <Input
        ref={inputRef}
        name="title"
        placeholder="Card title"
        aria-label="Card title"
        disabled={isPending}
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Adding…" : "Add card"}
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
