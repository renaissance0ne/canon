import Link from "next/link";
import { CanonLockup } from "@/components/canon-mark";

/**
 * The frame around Clerk's sign-in and sign-up widgets.
 *
 * Deliberately NOT a GlassPanel: Clerk renders its own card, and nesting one
 * inside another produces two stacked borders. The shell supplies the field
 * grid, the lockup and the standing promise; Clerk's card sits directly on it,
 * themed to match by lib/clerk-appearance.ts.
 */
export function AuthShell({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field-grid flex min-h-dvh flex-col">
      <div className="mx-auto w-full max-w-[1120px] px-8 py-8">
        <Link href="/" className="no-underline">
          <CanonLockup size={18} />
        </Link>
      </div>

      <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center px-8 pb-24">
        <p className="mb-5 text-label uppercase text-g-500">{eyebrow}</p>

        {children}

        <p className="mt-7 border-t border-hairline pt-5 text-body text-g-600">
          Canon runs single-tenant, one workspace per organization. It never
          writes back to Salesforce or the warehouse — it proposes, records every
          decision, and hands you a file.
        </p>
      </div>
    </div>
  );
}
