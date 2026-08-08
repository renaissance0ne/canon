import { NavRail } from "@/components/console/nav-rail";
import { requireReviewer } from "@/lib/server/auth";

/**
 * Every console screen renders a company's org chart, territories and reporting
 * lines, so the whole group is signed-in only.
 *
 * The gate is repeated on each page inside this group rather than left here
 * alone. A layout is not an authentication boundary in the App Router — it does
 * not re-run for every navigation into its children, and a page can be
 * requested as an RSC payload without its layout. Next.js says as much, and it
 * is the same class of gap that got `createRouteMatcher` deprecated: a check
 * that sits next to the data is the only one that cannot be routed around.
 *
 * This call is the cheap outer guard; `requireReviewer()` in each page is the
 * one that actually protects the query.
 */
export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireReviewer();

  return (
    <div className="flex min-h-dvh bg-surface-sunken">
      <NavRail />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
