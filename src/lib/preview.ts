import { readdirSync } from "node:fs";
import path from "node:path";
import { pagePath, type Cluster } from "./clusters";

/**
 * Partial PR previews: which worksheet pages THIS build carries, and where the
 * rest live.
 *
 * A preview sits at /pr-preview/pr-N/ on the same origin as production, so a
 * page the PR did not touch already exists — byte for byte what the merge
 * would leave — at the same path on the origin's root. Rendering and
 * publishing it again under the preview only copies production (each copy is
 * the whole site, ~165 MB today, and the gh-pages tip carries one per open
 * PR). So CI tells the build which worksheets the PR touched
 * (.github/workflows/site.yml, from `gh pr diff`), and a preview renders and
 * ships only those plus the shell — homepage, /admin/status, /intensives,
 * /license — while every other worksheet link goes to the live site.
 *
 *   PREVIEW_CHANGED_SLUGS  comma-separated slugs whose tex/<slug>/ the PR
 *                          touched; may be empty. Highlighted on the homepage
 *                          and in the sidebar.
 *   PREVIEW_FULL           "true" when the PR touched a shared input
 *                          (iliad.sty, the converter, src/, schedule.yaml…):
 *                          every page is rebuilt and published, as before.
 *                          Changed slugs are still highlighted.
 *   NEXT_PUBLIC_DIFF_BASE  where the live site is, for links to unpublished
 *                          pages. Empty (CI) means this origin's root; a local
 *                          build points it at https://iliad-intensive.org.
 *
 * Only a preview build (NEXT_PUBLIC_PREVIEW_PR set) is ever partial: a
 * production build ignores both variables, so a stray environment value can
 * never drop pages from the live site.
 */

export const PREVIEW_PR = process.env.NEXT_PUBLIC_PREVIEW_PR || undefined;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const LIVE = process.env.NEXT_PUBLIC_DIFF_BASE ?? "";

const RAW = process.env.PREVIEW_CHANGED_SLUGS;
const FULL = /^(1|true)$/i.test(process.env.PREVIEW_FULL ?? "");

/** Worksheets whose own sources the PR touched. Empty outside previews. */
export const CHANGED: ReadonlySet<string> = new Set(
  PREVIEW_PR ? (RAW ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [],
);

/** True when this build publishes only the CHANGED worksheet pages. */
export const PARTIAL = !!PREVIEW_PR && RAW !== undefined && !FULL;

// Every worksheet the content build produced: the slugs a two-segment path
// like /agency/aixi/ can name. Read once, so /intensives/<x>/ is never mistaken
// for a worksheet whose page this build left out.
const WORKSHEETS: ReadonlySet<string> = (() => {
  try {
    return new Set(
      readdirSync(path.join(process.cwd(), "content", "modules"))
        .filter((f) => f.endsWith(".mdx"))
        .map((f) => f.slice(0, -".mdx".length)),
    );
  } catch {
    return new Set();
  }
})();

export const isChanged = (slug: string): boolean => CHANGED.has(slug);

/** Does this build render the page for `slug`? */
export const isPublished = (slug: string): boolean => !PARTIAL || CHANGED.has(slug);

/**
 * A worksheet page's href as seen from this build: the preview's own copy when
 * it has one, else the live page. `live` tells the caller to render a plain
 * <a> — <Link> would add the base path and land inside the preview, where the
 * page does not exist.
 */
export function moduleHref(
  cluster: string | null | undefined,
  slug: string,
  clusters: Cluster[],
): { href: string; live: boolean } {
  const p = pagePath(cluster, slug, clusters);
  return isPublished(slug) ? { href: p, live: false } : { href: `${LIVE}${p}/`, live: true };
}

/**
 * A root-relative site URL — a download, an upload, a cross-worksheet link in
 * a body — resolved for this build: base-path-prefixed when its target is in
 * the build, pointed at the live site when a partial preview left the target
 * out. Anything that is not a root-relative path passes through untouched.
 */
export function siteHref(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  if (PARTIAL) {
    const m = /^\/(?:downloads|uploads)\/([^/?#]+)|^\/[^/?#]+\/([^/?#]+)\/?(?:[?#]|$)/.exec(href);
    const slug = m?.[1] ?? m?.[2];
    if (slug && WORKSHEETS.has(slug) && !CHANGED.has(slug)) return `${LIVE}${href}`;
  }
  return `${BASE_PATH}${href}`;
}
