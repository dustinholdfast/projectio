import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { verifyResetToken } from "@/lib/password-reset";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Redeem a reset link.
 *
 * The token is checked here so an expired or spent link says so immediately
 * rather than after the user has typed a new password twice. It is re-checked in
 * the action — this pass is for the message, not for the security decision.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const check = await verifyResetToken(token ?? "");

  if (!check.valid) {
    return (
      <AuthShell
        eyebrow="Account recovery"
        title="This link has expired"
        description="Reset links are valid for one hour and can be used once."
        footer={
          <p className="text-sm text-muted-foreground">
            <Link
              href="/forgot-password"
              className="font-medium text-primary hover:underline"
            >
              Request a new link
            </Link>
          </p>
        }
      >
        <p role="alert" className="text-sm text-destructive">
          This reset link is invalid or has expired. Request a new one.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Choose a new password"
      description="Pick something you haven't used elsewhere."
      footer={
        <p className="text-sm text-muted-foreground">
          Changed your mind?{" "}
          <Link
            href="/login"
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <ResetPasswordForm token={token ?? ""} />
    </AuthShell>
  );
}
