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

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
// Preview builds (and only they) also ship the diff view; see PreviewBanner.
const IS_PREVIEW = !!process.env.NEXT_PUBLIC_PREVIEW_PR;

export const metadata: Metadata = {
  title: "Iliad Intensive Curriculum",
  description:
    "April 2026 cohort — AI Safety theory of deep learning, agency, alignment.",
  // A PR preview is a complete copy of the site at a public URL under the
  // production domain (/pr-preview/pr-N/), built from a branch nobody has
  // reviewed yet. Search engines must not index it: a stale or wrong draft
  // would compete with the real page for the same query, and the domain's
  // reputation would vouch for whatever the branch contains. So every preview
  // page carries <meta name="robots" content="noindex, nofollow">.
  //
  // A robots.txt Disallow would be the wrong tool: a crawler it blocks never
  // fetches the page, so it never sees a noindex either, and Google still
  // lists the bare URL when something links to it (PR comments do). Blocking
  // nothing and marking every page is what actually keeps previews out.
  //
  // Metadata merges shallowly by top-level key, and no page sets `robots` of
  // its own, so this reaches every route. Production builds leave it out.
  ...(IS_PREVIEW ? { robots: { index: false, follow: false } } : {}),
};

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
        {/* On a preview the banner and the navbar stick together at the top of
            the viewport, so the banner's controls (the diff view, "next
            change") stay in reach however far down a long worksheet the reader
            is. public/site.js measures #top-stack into --top-h, which the
            sidebar's sticky offset and anchor scrolling are set from. */}
        {IS_PREVIEW ? (
          <div id="top-stack" className="sticky top-0 z-40">
            <PreviewBanner />
            <Navbar />
          </div>
        ) : (
          <Navbar />
        )}
        {children}
        {/* The site's entire client-side behaviour (~1.5 KB): sidebar toggle,
            close-on-mobile, the downloads solutions swap. Worksheet pages ship
            this and nothing else — scripts/strip-hydration.mjs removes the
            framework bundles after the build. */}
        <script defer src={`${BASE_PATH}/site.js`} />
        {IS_PREVIEW && <script defer src={`${BASE_PATH}/diff.js`} />}
      </body>
    </html>
  );
}
