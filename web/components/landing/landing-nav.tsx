import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { CanonLockup } from "@/components/canon-mark";
import { GradualBlur } from "@/components/visual/gradual-blur";
import { Button } from "@/components/ui/button";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#severity", label: "Severity" },
  { href: "#audit", label: "Audit" },
] as const;

/** Floating chrome, so it is allowed to be glass. */
export function LandingNav() {
  return (
    <header className="glass-veil sticky top-0 z-20 border-b border-hairline">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-8 px-8">
        <Link href="/" className="no-underline">
          <CanonLockup size={18} />
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-label uppercase text-g-500 no-underline transition-colors duration-[80ms] ease-canon hover:text-g-900"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* The landing page is the only public route, so it is the one place
            that has to render both states. */}
        <div className="ml-auto flex items-center gap-2">
          <Show when="signed-out">
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in" className="no-underline">
                Sign in
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up" className="no-underline">
                Sign up
              </Link>
            </Button>
          </Show>
          <Show when="signed-in">
            <Button asChild size="sm">
              <Link href="/get-started" className="no-underline">
                Open console
              </Link>
            </Button>
            <UserButton />
          </Show>
        </div>
      </div>

      {/* A short ramp immediately below the bar, travelling with it. The veil is
          62% opaque, which is enough to sit over the page but not enough to stop
          a line of mono from being read through it — this dissolves whatever is
          about to pass underneath so the two never compete. `top-full` wins over
          the component's own `top-0` through tailwind-merge. */}
      <GradualBlur position="top" height="56px" strength={5} className="top-full" />
    </header>
  );
}
