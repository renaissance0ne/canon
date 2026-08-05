import { cn } from "@/lib/cn";

export function LandingSection({
  id,
  eyebrow,
  title,
  lede,
  children,
  className,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn("mx-auto max-w-[1120px] scroll-mt-20 px-8 py-20", className)}
    >
      <p className="text-label uppercase text-g-500">{eyebrow}</p>
      <h2 className="mt-3 max-w-[640px] text-display text-g-900" style={{ textWrap: "pretty" }}>
        {title}
      </h2>
      {lede ? (
        <p className="mt-3 max-w-[600px] text-body text-g-600" style={{ textWrap: "pretty" }}>
          {lede}
        </p>
      ) : null}
      <div className="mt-10">{children}</div>
    </section>
  );
}
