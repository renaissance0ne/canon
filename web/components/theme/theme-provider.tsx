"use client";

import * as React from "react";
import {
  DARK_MEDIA_QUERY,
  isThemePreference,
  resolveTheme,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  THEME_SWITCHING_ATTRIBUTE,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

/* ── The store ─────────────────────────────────────────────────────────────
   The preference is not React state. It lives in localStorage, it is changed
   by other tabs, and when it is "system" it is answered by matchMedia — three
   external systems, which is exactly what useSyncExternalStore is for. Reading
   it into state on mount instead would be a setState in an effect: a cascading
   render on every page load, and a lint error to match.
   ─────────────────────────────────────────────────────────────────────── */

const listeners = new Set<() => void>();

/** Cached so getSnapshot does not touch localStorage on every render. */
let cachedPreference: ThemePreference | null = null;

function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    // Site data blocked (a private window, a browser set to refuse it). The
    // preference is then per-session, which is degraded rather than broken.
    return "system";
  }
}

function currentPreference(): ThemePreference {
  cachedPreference ??= readStoredPreference();
  return cachedPreference;
}

function emit() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== THEME_STORAGE_KEY) return;
  // A reviewer with the queue open in one tab and a run in another should not
  // be looking at two different themes.
  cachedPreference = isThemePreference(event.newValue) ? event.newValue : "system";
  emit();
}

/** Only changes the answer while the preference is "system"; an explicit choice
 *  outranks the OS. Subscribed unconditionally because the preference can
 *  become "system" again without the subscription being rebuilt. */
function onSystemChange() {
  if (currentPreference() === "system") emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
    window.matchMedia(DARK_MEDIA_QUERY).addEventListener("change", onSystemChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
      window
        .matchMedia(DARK_MEDIA_QUERY)
        .removeEventListener("change", onSystemChange);
    }
  };
}

function getResolvedSnapshot(): ResolvedTheme {
  return resolveTheme(currentPreference(), systemPrefersDark());
}

/* The server has no preference to read, so it renders the neutral pair and
   useSyncExternalStore swaps in the real one immediately after hydration. The
   switch shows nothing wrong in between: its thumb is positioned by CSS off
   data-theme, which the inline script set before any of this ran. */
const serverPreference = (): ThemePreference => "system";
const serverResolved = (): ResolvedTheme => "light";

function writePreference(next: ThemePreference) {
  cachedPreference = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // The theme still applies; it just will not survive a reload.
  }
  emit();
}

/**
 * Applies a resolved theme to <html>.
 *
 * The switching attribute is set for exactly one frame around the change. Every
 * transition in the app is suppressed while it is present (styles/tokens.css),
 * because a hairline crossfading through mid-gray for 80ms reads as a rendering
 * fault rather than as a transition.
 */
function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  if (root.getAttribute(THEME_ATTRIBUTE) === theme) return;

  root.setAttribute(THEME_SWITCHING_ATTRIBUTE, "");
  root.setAttribute(THEME_ATTRIBUTE, theme);

  // Two frames: one for the attribute to take effect, one for the browser to
  // have painted it. Removing it in the same frame would be a no-op.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.removeAttribute(THEME_SWITCHING_ATTRIBUTE);
    });
  });
}

type ThemeContextValue = {
  /** What the reviewer chose. "system" until they choose otherwise. */
  preference: ThemePreference;
  /** What that choice currently resolves to — what the DOM is actually in. */
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

/**
 * Publishes the theme to the app.
 *
 * It does NOT own first paint — the inline script in app/layout.tsx has already
 * written data-theme before this component exists, which is the only way to
 * load a dark page without a white flash. This provider takes over from there:
 * it reads the same preference back, keeps the attribute in step with it, and
 * re-resolves "system" when the OS setting changes.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = React.useSyncExternalStore(
    subscribe,
    currentPreference,
    serverPreference,
  );
  const resolvedTheme = React.useSyncExternalStore(
    subscribe,
    getResolvedSnapshot,
    serverResolved,
  );

  // Pushing the theme back out to the DOM — the one direction an effect is for.
  // A no-op on load, because the inline script already wrote it.
  //
  // The store is re-read here rather than the rendered `resolvedTheme` used,
  // and that is the whole point: useSyncExternalStore serves the SERVER
  // snapshot through hydration, so the first commit of a dark page renders
  // "light". Writing that value out would flip <html> to light for the frame
  // between hydration and the store re-sync — the exact flash the inline script
  // exists to prevent, arriving a beat later. The dependency still fires the
  // effect on every change; only the value written comes from the store.
  React.useEffect(() => {
    applyTheme(getResolvedSnapshot());
  }, [resolvedTheme]);

  // The switch is two-state: it commits to whichever theme is not on screen,
  // which also means the first toggle is what turns "system" into a choice.
  const toggle = React.useCallback(() => {
    writePreference(getResolvedSnapshot() === "dark" ? "light" : "dark");
  }, []);

  const value = React.useMemo(
    () => ({
      preference,
      resolvedTheme,
      setPreference: writePreference,
      toggle,
    }),
    [preference, resolvedTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>.");
  }
  return context;
}
