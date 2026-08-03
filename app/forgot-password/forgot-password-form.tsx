"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  requestPasswordReset,
  type ResetRequestState,
} from "@/lib/actions/password-reset";
import { Button, Input, Label } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Sending…" : "Send reset link"}
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<ResetRequestState, FormData>(
    requestPasswordReset,
    undefined,
  );

  // Deliberately the same confirmation whether or not an account exists — the
  // screen must not reveal which addresses are registered.
  if (state?.sent) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        If an account exists for that address, a reset link is on its way. The
        link is valid for one hour.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
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
