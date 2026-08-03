"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button, Input, Label } from "@/components/ui";
import { createBoard, type BoardActionState } from "@/lib/actions/board";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create board"}
    </Button>
  );
}

/**
 * Create a board. Used both in the empty state (a fresh signup with no boards)
 * and alongside the list once boards exist. The action redirects into the new
 * board on success, so there is no local success state to handle here.
 */
export function CreateBoardForm() {
  const [state, formAction] = useActionState<BoardActionState, FormData>(
    createBoard,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="board-name">Board name</Label>
        <Input
          id="board-name"
          name="name"
          placeholder="Product Roadmap"
          required
        />
      </div>
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
