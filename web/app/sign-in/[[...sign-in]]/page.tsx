import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth/auth-shell";

/**
 * Catch-all so Clerk can own its own sub-steps (factor-two, SSO callback,
 * reset-password) without a route per step.
 */
export default function SignInPage() {
  return (
    <AuthShell eyebrow="Sign in">
      <SignIn />
    </AuthShell>
  );
}
