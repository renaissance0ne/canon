import { cn } from "@/lib/cn";

/**
 * The docs page's building blocks. Long-form, but held to the console's own
 * grammar: hairlines instead of cards, mono for anything a source system or a
 * terminal would print, sans for Canon explaining it. No hue anywhere.
 */

/** One numbered section of the guide. `id` is its anchor in the contents. */
export function DocSection({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  /** One sentence under the heading: what this section is for. */
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    // scroll-mt clears the sticky page header, so a contents link lands on the
    // heading rather than underneath the glass.
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-hairline-strong pt-8">
      <h2 id={`${id}-title`} className="text-[22px] font-medium leading-7 tracking-[-0.015em] text-g-900">
        {title}
      </h2>
      {lead ? <p className="mt-2 max-w-[64ch] text-body text-g-600">{lead}</p> : null}
      <div className="mt-6 flex flex-col gap-5">{children}</div>
    </section>
  );
}

export function DocHeading({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-24 pt-2 text-heading text-g-900">
      {children}
    </h3>
  );
}

export function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("max-w-[68ch] text-body text-g-700", className)}>{children}</p>;
}

/** A value, an id, a field name, a command fragment — anything from a system. */
export function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-value text-g-900">{children}</code>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[2px] border border-hairline-strong bg-g-0 px-1 py-0.5 font-mono text-[11px] text-g-900">
      {children}
    </kbd>
  );
}

/** Shell commands. Scrolls sideways rather than wrapping a command mid-flag. */
export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="max-w-[760px]">
      {label ? (
        <figcaption className="mb-1 text-label uppercase text-g-500">{label}</figcaption>
      ) : null}
      <pre className="overflow-x-auto border border-hairline bg-surface-sunken px-4 py-3 font-mono text-value text-g-900">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

/**
 * A reference table: term on the left, explanation on the right. A data
 * surface like every other table in the console — opaque, square, hairlines.
 */
export function DocTable({
  head,
  rows,
  className,
}: {
  head: readonly string[];
  rows: readonly (readonly React.ReactNode[])[];
  className?: string;
}) {
  return (
    <div className={cn("max-w-[880px] overflow-x-auto", className)}>
      <table className="w-full border-collapse bg-g-0 text-left">
        <thead>
          <tr className="border-b border-hairline-strong">
            {head.map((cell) => (
              <th key={cell} scope="col" className="py-2 pr-4 text-label font-medium uppercase text-g-500">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-hairline align-top">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    "py-2.5 pr-4 text-body",
                    // The first column names the thing; it never wraps mid-term.
                    cellIndex === 0 ? "whitespace-nowrap text-g-900" : "text-g-700",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** An ordered walkthrough. Numbers are mono, because they are a sequence, not prose. */
export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="flex max-w-[760px] flex-col border-t border-hairline">{children}</ol>;
}

export function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[2.5rem_1fr] gap-x-2 border-b border-hairline py-4">
      <span className="font-mono text-value text-g-500">{String(n).padStart(2, "0")}</span>
      <div className="flex flex-col gap-1.5">
        <p className="text-body font-medium text-g-900">{title}</p>
        <div className="flex flex-col gap-1.5 text-body text-g-700">{children}</div>
      </div>
    </li>
  );
}

/** A caveat worth stopping for. Ink rule on the left — the console's one emphasis. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[720px] border-l-2 border-g-900 bg-surface-sunken px-4 py-3 text-body text-g-700">
      {children}
    </div>
  );
}
