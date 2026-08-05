import { cn } from "@/lib/cn";

/**
 * Canon mark — a muzzle read as a C, with the ball clearing it. Two elements,
 * one gesture; nothing in it is thinner than 7.5 units so it holds at 16px.
 * currentColor only: the mark is achromatic like everything else.
 */
export function CanonMark({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn("block shrink-0", className)}
    >
      <path
        d="M46.4 23A17 17 0 1 0 46.4 41"
        fill="none"
        stroke="currentColor"
        strokeWidth={size <= 18 ? 9 : 7.5}
        strokeLinecap="round"
      />
      <circle cx="56" cy="32" r={size <= 18 ? 6.5 : 6} fill="currentColor" />
    </svg>
  );
}

export function CanonLockup({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5 text-g-900", className)}>
      <CanonMark size={size} />
      <span
        className="font-sans font-semibold uppercase leading-none"
        style={{ fontSize: size * 0.72, letterSpacing: "0.16em" }}
      >
        Canon
      </span>
    </span>
  );
}
