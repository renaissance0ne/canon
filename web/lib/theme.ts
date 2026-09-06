/**
 * Theme preference, resolution and persistence.
 *
 * Three preferences, two themes. "system" is a preference, not a theme — it
 * resolves to one of the other two and is re-resolved when the OS setting
 * changes. Only the resolved value is ever written to the DOM, so CSS has a
 * single attribute to key off and never has to agree with a media query.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "light",
  "dark",
  "system",
];

/** Where the preference is kept. Per-browser, not per-account: a reviewer's
 *  choice of theme is not a fact about the org, so it does not belong in
 *  Postgres. */
export const THEME_STORAGE_KEY = "canon.theme";

/** Written to <html>. `styles/tokens.css` keys the dark ramp off this. */
export const THEME_ATTRIBUTE = "data-theme";

/** Set for the frame a switch lands in, so transitions do not smear it. */
export const THEME_SWITCHING_ATTRIBUTE = "data-theme-switching";

export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * The pre-hydration script, inlined into the document by `app/layout.tsx`.
 *
 * It runs synchronously before the body is painted, which is the only way to
 * avoid a white flash on a dark-theme load. It is written as a string because
 * it has to execute before any bundle does — there is no module to import it
 * from at that point.
 *
 * Kept deliberately small and total: any throw here would leave the page
 * unstyled, so a failed read of localStorage (Safari private mode, a browser
 * set to block site data) falls through to the system preference rather than
 * propagating.
 */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(p!=="light"&&p!=="dark")p=window.matchMedia(${JSON.stringify(
  DARK_MEDIA_QUERY,
)}).matches?"dark":"light";document.documentElement.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},p);}catch(e){document.documentElement.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},"light");}})();`;
