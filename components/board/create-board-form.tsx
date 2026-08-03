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
 * Empty-state form shown when the signed-in user has no board yet (e.g. a fresh
 * signup). Creating one reloads the view into the full board. Structure/behavior
 * only — the restyle card owns final presentation.
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
