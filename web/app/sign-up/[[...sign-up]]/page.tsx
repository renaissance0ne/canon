import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth/auth-shell";

/**
 * Replaces the earlier placeholder form, which posted nowhere. Catch-all so
 * Clerk owns verification and its own sub-steps.
 */
export default function SignUpPage() {
  return (
    <AuthShell eyebrow="Sign up">
      <SignUp />
    </AuthShell>
  );
}
