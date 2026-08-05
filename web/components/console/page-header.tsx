import { cn } from "@/lib/cn";

/**
 * Sticky glass header. The only ornament allowed above a data surface, and it
 * is translucent so the table scrolling under it stays legible as it passes.
 */
export function PageHeader({
  title,
  meta,
  actions,
  className,
}: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "glass-veil sticky top-0 z-10 flex items-baseline gap-4 border-b border-hairline px-10 py-5",
        className,
      )}
    >
      <h1 className="text-heading text-g-900">{title}</h1>
      {meta ? <p className="font-mono text-value text-g-500">{meta}</p> : null}
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
