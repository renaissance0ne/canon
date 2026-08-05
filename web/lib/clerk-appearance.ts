/**
 * Clerk, restricted to Canon's achromatic token set.
 *
 * AGENTS.md § Design System is a hard constraint: "No hue anywhere: not in
 * status, not in severity, not in charts, not in the logo." Clerk ships a blue
 * primary, a red danger and a green success out of the box, so every colour
 * variable has to be mapped explicitly — the defaults are the failure mode.
 *
 * The values are the same twelve grays as styles/tokens.css. They are written
 * as literals rather than `var(--color-g-*)` because Clerk renders parts of its
 * UI (modals, the user popover) in portals, and a portal that escapes the
 * cascade would otherwise lose the variables and fall back to Clerk's palette.
 * Fonts stay as `var()` — next/font sets those on <html>, which portals inherit.
 */
const G = {
  g0: "#FFFFFF",
  g100: "#F4F4F5",
  g200: "#E4E4E7",
  g400: "#A1A1AA",
  g600: "#52525B",
  g700: "#3F3F46",
  g900: "#18181B",
} as const;

export const clerkAppearance = {
  variables: {
    colorPrimary: G.g900,
    colorPrimaryForeground: G.g0,

    colorBackground: G.g0,
    colorForeground: G.g900,
    colorMuted: G.g100,
    colorMutedForeground: G.g600,

    colorInput: G.g0,
    colorInputForeground: G.g900,
    colorBorder: G.g200,
    colorNeutral: G.g900,

    // "No exceptions, no accents, no 'just one color for errors'." A destructive
    // state is ink plus a word, exactly as components/ui/button.tsx treats it.
    colorDanger: G.g900,
    colorSuccess: G.g700,
    colorWarning: G.g600,

    // There is no colour, so focus has to be unmissable on its own.
    colorRing: G.g900,

    // "No shadows. No gradients. No glows." A surface is raised by a hairline.
    colorShadow: "transparent",
    colorModalBackdrop: "rgba(9, 9, 11, 0.4)",
    colorShimmer: G.g100,

    fontFamily: "var(--font-plex-sans)",
    fontFamilyButtons: "var(--font-plex-sans)",
    fontFamilyMono: "var(--font-plex-mono)",
    fontSize: "0.875rem",

    // 2px on interactive elements only — data surfaces stay square.
    borderRadius: "2px",
  },
  options: {
    // Nothing else in this interface is a pill, and a row of branded social
    // buttons would be the only colour on the page.
    socialButtonsVariant: "blockButton",
    showOptionalFields: false,
  },
} as const;

/** Placeholder gray for Clerk's own inputs, matching components/ui/input.tsx. */
export const CLERK_PLACEHOLDER = G.g400;
