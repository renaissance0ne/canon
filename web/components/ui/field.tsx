import { cn } from "@/lib/cn";
import { Label } from "@/components/ui/label";

/**
 * Label · control · hint · error, stacked. Every form in the console is this
 * shape (wireframes 1c, 1d, 1e), and the error slot is part of the primitive so
 * a field cannot be built without somewhere for its message to land.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? (
        <p id={hintId} className="text-body text-g-500">
          {hint}
        </p>
      ) : null}
      {/* aria-live: the message arrives after a failed submit, so a screen
          reader has to be told rather than asked to go looking. */}
      <p id={errorId} aria-live="polite" className="empty:hidden text-body text-g-900">
        {error ? <span className="border-l-2 border-g-900 pl-2">{error}</span> : null}
      </p>
    </div>
  );
}

/** The ids `Field` wires up, so the control inside can claim them. */
export function fieldAria(htmlFor: string, { hint, error }: { hint?: boolean; error?: boolean }) {
  const describedBy = [hint ? `${htmlFor}-hint` : null, error ? `${htmlFor}-error` : null]
    .filter(Boolean)
    .join(" ");

  return {
    id: htmlFor,
    "aria-invalid": error || undefined,
    "aria-describedby": describedBy || undefined,
  };
}
