import { ThemedSignUp } from "@/components/auth/themed-clerk";
import { AuthShell } from "@/components/auth/auth-shell";

/**
 * Replaces the earlier placeholder form, which posted nowhere. Catch-all so
 * Clerk owns verification and its own sub-steps.
 */
export default function SignUpPage() {
  return (
    <AuthShell eyebrow="Sign up">
      <ThemedSignUp />
    </AuthShell>
  );
}
