import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { THEME_SCRIPT } from "@/lib/theme";
import "@/styles/tokens.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

/** Every data value is mono. This is not decorative — it is the type contract. */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Canon",
  description:
    "Canon reconciles organizational structure between a CRM and a warehouse, and resolves the disagreements between them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme script writes data-theme on this element before React sees it,
    // which is a server/client mismatch by construction rather than by mistake.
    <html
      lang="en"
      className={plexSans.variable + " " + plexMono.variable}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        {/* First child of <body>, and inline rather than next/script, so it runs
            during parse — before anything is painted. Any later and a dark-theme
            load flashes white. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />

        {/* Appearance is set once, here. Clerk's defaults are chromatic, so a
            component rendered without it would be the only hue in the app.
            This is the light palette; the widgets that actually render pass the
            dark one themselves — see components/auth/themed-clerk.tsx for why
            it cannot be swapped from up here. */}
        <ClerkProvider appearance={clerkAppearance}>
          <ThemeProvider>{children}</ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
