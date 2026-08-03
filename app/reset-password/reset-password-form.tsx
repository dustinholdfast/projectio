"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  resetPassword,
  type ResetPasswordState,
} from "@/lib/actions/password-reset";
import { Button, Input, Label } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Saving…" : "Set new password"}
    </Button>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ResetPasswordState, FormData>(
    resetPassword,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* The link's token rides along with the submission. */}
      <input type="hidden" name="token" value={token} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
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
