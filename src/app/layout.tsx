import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { PreviewBanner } from "@/components/PreviewBanner";

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const serif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Iliad Intensive Curriculum",
  description:
    "April 2026 cohort — AI Safety theory of deep learning, agency, alignment.",
};

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Restores the sidebar state before first paint: the open/closed mode is a
 * `nav-open` class on <html> (see #page-shell in globals.css), owned by
 * public/site.js and persisted in localStorage. Restoring it here rather than
 * in site.js means no flash of the wrong layout. Must be inline and blocking.
 */
const RESTORE_NAV =
  `try{if(localStorage.getItem("iliad.navOpen")==="1")` +
  `document.documentElement.classList.add("nav-open")}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: RESTORE_NAV adds `nav-open` to <html> before
    // React hydrates (on the pages that still hydrate, i.e. /admin/status),
    // and the class is ours, not React's, so the mismatch is expected.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-serif">
        <script dangerouslySetInnerHTML={{ __html: RESTORE_NAV }} />
        <PreviewBanner />
        <Navbar />
        {children}
        {/* The site's entire client-side behaviour (~1.5 KB): sidebar toggle,
            close-on-mobile, the downloads solutions swap. Worksheet pages ship
            this and nothing else — scripts/strip-hydration.mjs removes the
            framework bundles after the build. */}
        <script defer src={`${BASE_PATH}/site.js`} />
      </body>
    </html>
  );
}
