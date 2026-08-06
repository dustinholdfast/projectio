import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { safeCallbackUrl } from "@/lib/safe-callback-url";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; callbackUrl?: string }>;
}) {
  // Set by the password-reset action on success, so the user gets confirmation
  // that the change took effect rather than an unexplained sign-in screen.
  const { reset, callbackUrl: requestedCallback } = await searchParams;
  const callbackUrl = safeCallbackUrl(requestedCallback);
  const signupHref =
    callbackUrl === "/"
      ? "/signup"
      : `/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in"
      description="Enter your details to access your board."
      footer={
        <p className="text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href={signupHref}
            className="font-medium text-primary hover:underline"
          >
            Sign up
          </Link>
        </p>
      }
    >
      {reset ? (
        <p role="status" className="text-sm text-muted-foreground">
          Your password has been changed. Sign in with your new password.
        </p>
      ) : null}
      <LoginForm callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
