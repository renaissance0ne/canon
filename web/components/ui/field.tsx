import { cn } from "@/lib/cn";
import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/ui/tooltip";

/**
 * Label · control · hint · error, stacked. Every form in the console is this
 * shape (wireframes 1c, 1d, 1e), and the error slot is part of the primitive so
 * a field cannot be built without somewhere for its message to land.
 */
export function Field({
  label,
  htmlFor,
  hint,
  tip,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  /**
   * A longer explanation behind a `?` beside the label — the concept, where
   * `hint` is the one line a reader needs to fill the field in. Kept outside
   * the <label>, because a button inside one would be a second labelable
   * element and clicking it would focus the control instead.
   */
  tip?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {tip ? (
        <span className="flex items-center gap-1">
          <Label htmlFor={htmlFor}>{label}</Label>
          <InfoTip label={`About ${label}`} content={tip} />
        </span>
      ) : (
        <Label htmlFor={htmlFor}>{label}</Label>
      )}
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
