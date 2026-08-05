import { NavRail } from "@/components/console/nav-rail";

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="field-grid flex min-h-dvh">
      <NavRail />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
