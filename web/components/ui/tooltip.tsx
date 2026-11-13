"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Tooltips, built here rather than installed. The console's dependency surface
 * is deliberately small (AGENTS.md § Decision Making), and what a tooltip has to
 * do is short enough to own:
 *
 *   - open on hover AND on keyboard focus, so a reviewer who never touches the
 *     mouse gets every explanation a mouse user does;
 *   - stay open while the pointer moves onto it, and close on Escape, blur, or
 *     pointer leave (WCAG 1.4.13 — hoverable, dismissible, persistent);
 *   - be announced: the text always sits in the DOM, hidden, referenced by
 *     `aria-describedby` from the trigger, so a screen reader reads it on focus
 *     whether or not the visual bubble has opened yet;
 *   - render into <body>. The rail and sticky headers are `backdrop-filter`
 *     glass, and a filtered ancestor captures `position: fixed` — a bubble
 *     rendered in place would be positioned against the header, not the page.
 *
 * Visually it is ink on paper inverted — `--g-900` ground, `--g-0` text — which
 * flips correctly in both themes with no hue anywhere. Square, because it is
 * not interactive (2px radius is for things you can click), and it appears
 * without animating: the queue stagger is the console's one entry motion.
 */

type Side = "top" | "bottom" | "right";

/** Hover intent: sweeping the pointer across a row of chips must not strobe. */
const OPEN_DELAY_MS = 150;
/** Long enough to cross the gap from trigger to bubble without it vanishing. */
const CLOSE_DELAY_MS = 120;
const GAP_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

function useTooltip(side: Side) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback(
    (delay = 0) => {
      clearTimer();
      if (delay > 0) timer.current = window.setTimeout(() => setOpen(true), delay);
      else setOpen(true);
    },
    [clearTimer],
  );

  const hide = useCallback(
    (delay = 0) => {
      clearTimer();
      if (delay > 0) timer.current = window.setTimeout(() => setOpen(false), delay);
      else setOpen(false);
    },
    [clearTimer],
  );

  // Placed after the bubble renders, so its real size is known. Written to the
  // node directly rather than through state: the position is a pure function of
  // two rectangles, and a second render to apply it would show one frame of the
  // bubble at the origin.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;

    const a = anchor.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top: number;
    let left: number;

    if (side === "right") {
      left = a.right + GAP_PX;
      top = a.top + a.height / 2 - b.height / 2;
      if (left + b.width > vw - VIEWPORT_MARGIN_PX) left = a.left - GAP_PX - b.width;
    } else {
      const above = side === "top";
      top = above ? a.top - GAP_PX - b.height : a.bottom + GAP_PX;
      // Flip when the preferred side would leave the viewport.
      if (above && top < VIEWPORT_MARGIN_PX) top = a.bottom + GAP_PX;
      if (!above && top + b.height > vh - VIEWPORT_MARGIN_PX) top = a.top - GAP_PX - b.height;
      left = a.left + a.width / 2 - b.width / 2;
    }

    left = clamp(left, VIEWPORT_MARGIN_PX, vw - b.width - VIEWPORT_MARGIN_PX);
    top = clamp(top, VIEWPORT_MARGIN_PX, vh - b.height - VIEWPORT_MARGIN_PX);

    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
    bubble.style.visibility = "visible";
  }, [open, side]);

  // Escape from anywhere dismisses it; so does the page moving under it, since
  // a fixed bubble would otherwise float away from its trigger.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onMove = () => hide();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, hide]);

  useEffect(() => clearTimer, [clearTimer]);

  // Callback refs, so the trigger and the bubble register themselves and the
  // ref objects never leave this hook. Handing a ref object back would make
  // every read of the returned value a read of a ref during render.
  const setAnchor = useCallback((node: HTMLElement | null) => {
    anchorRef.current = node;
  }, []);
  const setBubble = useCallback((node: HTMLDivElement | null) => {
    bubbleRef.current = node;
  }, []);

  const triggerHandlers = {
    onPointerEnter: () => show(OPEN_DELAY_MS),
    onPointerLeave: () => hide(CLOSE_DELAY_MS),
    onFocus: () => show(),
    onBlur: () => hide(),
  };

  return { open, show, hide, setAnchor, setBubble, triggerHandlers };
}

function Bubble({
  open,
  bubbleRef,
  onPointerEnter,
  onPointerLeave,
  children,
}: {
  open: boolean;
  bubbleRef: (node: HTMLDivElement | null) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return createPortal(
    // aria-hidden: the same text is already the trigger's accessible
    // description, and announcing it twice is noise.
    <div
      ref={bubbleRef}
      aria-hidden
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{ position: "fixed", top: 0, left: 0, visibility: "hidden" }}
      className="z-50 max-w-[300px] bg-g-900 px-2.5 py-1.5 text-left font-sans text-[12px] font-normal normal-case leading-[17px] tracking-normal text-g-0"
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Wraps an element that is ALREADY focusable — a link, a button — and gives it
 * a tooltip. The child must set `aria-describedby={id}` itself; the id is
 * passed in rather than generated so a Server Component can wire both ends.
 */
export function Tooltip({
  id,
  content,
  side = "top",
  className,
  children,
}: {
  id: string;
  content: ReactNode;
  side?: Side;
  className?: string;
  children: ReactNode;
}) {
  // Destructured, not held as one object: one member is a ref callback, and
  // the compiler would otherwise treat every member as a ref.
  const { open, show, hide, setAnchor, setBubble, triggerHandlers } = useTooltip(side);

  return (
    <span
      ref={setAnchor}
      className={cn("inline-flex", className)}
      {...triggerHandlers}
    >
      {children}
      <span id={id} hidden>
        {content}
      </span>
      <Bubble
        open={open}
        bubbleRef={setBubble}
        onPointerEnter={() => show()}
        onPointerLeave={() => hide(CLOSE_DELAY_MS)}
      >
        {content}
      </Bubble>
    </span>
  );
}

/**
 * A small `?` beside a label. For explanations that sit next to text rather
 * than on it: form fields, section eyebrows, column headers.
 *
 * Clicking opens rather than toggles. Focus already opened it on the same
 * gesture, and a toggle would close it again before it was read; on touch a
 * tap opens it and a tap elsewhere closes it.
 */
export function InfoTip({
  label,
  content,
  side = "top",
  className,
}: {
  /** What a screen reader calls the button: "About escalated". */
  label: string;
  content: ReactNode;
  side?: Side;
  className?: string;
}) {
  const id = useId();
  // Destructured, not held as one object: one member is a ref callback, and
  // the compiler would otherwise treat every member as a ref.
  const { open, show, hide, setAnchor, setBubble, triggerHandlers } = useTooltip(side);

  return (
    <span className={cn("inline-flex align-middle", className)}>
      <button
        ref={setAnchor}
        type="button"
        aria-label={label}
        aria-describedby={id}
        onClick={() => show()}
        {...triggerHandlers}
        className="group -my-1 inline-flex h-5 w-5 items-center justify-center rounded-[2px]"
      >
        <span
          aria-hidden
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border border-hairline-strong font-mono text-[9px] leading-none text-g-500 transition-colors duration-[80ms] ease-canon group-hover:border-g-900 group-hover:text-g-900"
        >
          ?
        </span>
      </button>
      <span id={id} hidden>
        {content}
      </span>
      <Bubble
        open={open}
        bubbleRef={setBubble}
        onPointerEnter={() => show()}
        onPointerLeave={() => hide(CLOSE_DELAY_MS)}
      >
        {content}
      </Bubble>
    </span>
  );
}

/**
 * A word that explains itself: dotted underline, focusable, tooltip on hover or
 * focus. For labels that ARE the term being defined — stat names, column
 * headers — where a separate `?` would be one glyph too many.
 *
 * A real <button>, not a span with a tabindex, so Enter and Space work and
 * assistive technology knows it can be operated. It inherits the surrounding
 * type exactly, so it reads as the label it replaces.
 */
export function Term({
  content,
  side = "top",
  className,
  children,
}: {
  content: ReactNode;
  side?: Side;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  // Destructured, not held as one object: one member is a ref callback, and
  // the compiler would otherwise treat every member as a ref.
  const { open, show, hide, setAnchor, setBubble, triggerHandlers } = useTooltip(side);

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-describedby={id}
        onClick={() => show()}
        {...triggerHandlers}
        className={cn(
          "cursor-help rounded-[2px] text-left [font:inherit] [letter-spacing:inherit] [text-transform:inherit]",
          "underline decoration-g-400 decoration-dotted underline-offset-[3px]",
          "transition-colors duration-[80ms] ease-canon hover:decoration-g-900",
          className,
        )}
      >
        {children}
      </button>
      <span id={id} hidden>
        {content}
      </span>
      <Bubble
        open={open}
        bubbleRef={setBubble}
        onPointerEnter={() => show()}
        onPointerLeave={() => hide(CLOSE_DELAY_MS)}
      >
        {content}
      </Bubble>
    </>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
