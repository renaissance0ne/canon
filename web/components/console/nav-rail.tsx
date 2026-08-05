"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import { CanonLockup } from "@/components/canon-mark";
import { SignOutControl } from "@/components/auth/sign-out-control";
import { cn } from "@/lib/cn";
import { reviewerLabel } from "@/lib/reviewer-label";

const NAV = [
  { href: "/runs", label: "Runs" },
  { href: "/conflicts", label: "Conflicts" },
  { href: "/sources", label: "Sources" },
  { href: "/rules", label: "Rules" },
  { href: "/audit", label: "Audit" },
] as const;

/**
 * Fixed 240px rail, hairline-separated. No pills, no active fills — weight and
 * a 2px left mark carry state. Glass here is floating chrome, so it is allowed
 * to be translucent over the hairline field behind it.
 */
export function NavRail() {
  const pathname = usePathname();
  const { user, isLoaded } = useUser();

  return (
    <nav className="glass-veil sticky top-0 flex h-dvh w-[240px] shrink-0 flex-col border-r border-hairline px-5 py-6">
      <Link href="/runs" className="mb-10 no-underline">
        <CanonLockup size={18} />
      </Link>

      <ul className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-ml-3 flex h-8 items-center border-l-2 pl-3 no-underline",
                  "font-sans text-label uppercase transition-colors duration-[80ms] ease-canon",
                  active
                    ? "border-g-900 font-semibold text-g-900"
                    : "border-transparent text-g-500 hover:text-g-900",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Who is about to approve something. A reviewer working a queue needs to
          see which identity their decisions will be recorded under — the label
          here is the same one that lands in audit_log.actor. */}
      <div className="mt-auto flex flex-col gap-3 border-t border-hairline pt-4">
        <div className="flex items-center gap-2.5">
          <UserButton />
          {/* Reserved height either way, so the rail does not shift on load. */}
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-4 text-g-700">
            {isLoaded ? reviewerLabel(user, "signed in") : ""}
          </span>
        </div>

        {/* Explicit, not buried in the avatar menu. Signing out is how a
            reviewer hands the queue to someone else, and the next person's
            decisions must not be recorded under the last person's name. */}
        <SignOutControl full />

        <p className="font-mono text-[11px] leading-relaxed text-g-500">
          single-tenant
          <br />
          no write-back
        </p>
      </div>
    </nav>
  );
}
