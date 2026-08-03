import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <AuthShell
      eyebrow="Get started"
      title="Create your account"
      description="Set up a login to start organizing your board."
      footer={
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
