import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your password"
      description="Enter your email and we'll send a link to choose a new password."
      footer={
        <p className="text-sm text-muted-foreground">
          Remembered it?{" "}
          <Link
            href="/login"
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
