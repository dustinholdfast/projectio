import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { safeCallbackUrl } from "@/lib/safe-callback-url";
import { SignupForm } from "./signup-form";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl: requestedCallback } = await searchParams;
  const callbackUrl = safeCallbackUrl(requestedCallback);
  const loginHref =
    callbackUrl === "/"
      ? "/login"
      : `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <AuthShell
      eyebrow="Get started"
      title="Create your account"
      description="Set up a login to start organizing your board."
      footer={
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={loginHref}
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <SignupForm callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
