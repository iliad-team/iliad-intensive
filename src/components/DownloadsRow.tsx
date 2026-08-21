import type { ReactNode } from "react";

const LABELS: Record<string, string> = { pdf: "PDF", tex: "LaTeX", mdx: "Markdown" };

// Only PDFs get a View box: GitHub Pages serves .tex/.mdx with a download-y
// MIME type, so a "view" link on those would just re-download — download is
// the honest (and sufficient) action there.
const VIEWABLE = new Set(["pdf"]);

/** A small bordered action box. `download` → save the file (browser keeps its
 *  real name); otherwise → open in a new tab (PDFs render in the viewer).
 *  `sol`/`nosol` carry both variant hrefs for the solutions toggle in
 *  public/site.js — it swaps the live href when the checkbox changes. */
function Box({
  href, download, sol, nosol, children,
}: {
  href: string; download?: boolean; sol?: string; nosol?: string; children: ReactNode;
}) {
  const attrs = download
    ? { download: true }
    : { target: "_blank", rel: "noopener noreferrer" };
  return (
    <a
      href={href}
      data-sol={sol}
      data-nosol={nosol}
      {...attrs}
      className="rounded border border-zinc-300 px-2 py-0.5 lowercase tracking-normal text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-900"
    >
      {children}
    </a>
  );
}

/**
 * One row per available format (PDF · LaTeX · Markdown), each with view/
 * download boxes, plus a Slides row when a deck exists. `files` is the
 * build-time listing of public/downloads/<slug>/; the checkbox swaps the
 * worksheet rows between <slug>.<ext> and <slug>-nosol.<ext> (all
 * pre-generated build artifacts). Slides carry no solutions variant and are
 * unaffected by the toggle. `slidesUrl` is an externally hosted deck (from
 * the `slides:` frontmatter key) — linked, never hosted here; a compiled
 * <slug>-slides.pdf takes precedence over it.
 *
 * A deck that opted into a collapsed build ships <slug>-slides-handout.pdf
 * too; the row then reads present · handout · LaTeX instead of the
 * view · download · LaTeX it shows for a single-variant deck.
 *
 * Server-rendered: the with/without-solutions swap is public/site.js reading
 * the data-sol/data-nosol pairs off each link — no React on the client.
 */
export function DownloadsRow({
  slug,
  files,
  basePath,
  slidesUrl,
}: {
  slug: string;
  files: string[];
  basePath: string;
  slidesUrl?: string;
}) {
  const href = (file: string) => `${basePath}/downloads/${slug}/${file}`;
  const exts = (["pdf", "tex", "mdx"] as const).filter((ext) => files.includes(`${slug}.${ext}`));

  const hasSlidesPdf = files.includes(`${slug}-slides.pdf`);
  const hasSlidesTex = files.includes(`${slug}-slides.tex`);
  const hasSlidesHandout = files.includes(`${slug}-slides-handout.pdf`);

  if (exts.length === 0 && !hasSlidesPdf && !slidesUrl) return null;

  const rowLabel = "w-20 shrink-0 uppercase tracking-wide text-zinc-500";

  return (
    <div className="mt-4 font-sans text-xs">
      {exts.length > 0 && (
        <label className="mb-2.5 flex w-fit cursor-pointer select-none items-center gap-1.5 text-zinc-500">
          <input
            type="checkbox"
            id="solutions-toggle"
            defaultChecked
            className="accent-zinc-600"
          />
          with solutions
        </label>
      )}
      <ul className="flex flex-col gap-1.5">
        {exts.map((ext) => {
          const sol = href(`${slug}.${ext}`);
          const nosol = href(`${slug}-nosol.${ext}`);
          return (
            <li key={ext} className="flex items-center gap-2">
              <span className={rowLabel}>{LABELS[ext]}</span>
              {VIEWABLE.has(ext) && <Box href={sol} sol={sol} nosol={nosol}>view</Box>}
              <Box href={sol} sol={sol} nosol={nosol} download>download</Box>
            </li>
          );
        })}

        {hasSlidesPdf ? (
          <li className="flex items-center gap-2">
            <span className={rowLabel}>Slides</span>
            {hasSlidesHandout ? (
              <>
                <Box href={href(`${slug}-slides.pdf`)}>present</Box>
                <Box href={href(`${slug}-slides-handout.pdf`)}>handout</Box>
              </>
            ) : (
              <>
                <Box href={href(`${slug}-slides.pdf`)}>view</Box>
                <Box href={href(`${slug}-slides.pdf`)} download>download</Box>
              </>
            )}
            {hasSlidesTex && (
              <Box href={href(`${slug}-slides.tex`)} download>LaTeX</Box>
            )}
          </li>
        ) : slidesUrl ? (
          <li className="flex items-center gap-2">
            <span className={rowLabel}>Slides</span>
            <a
              href={slidesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-zinc-300 px-2 py-0.5 lowercase tracking-normal text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-900"
            >
              open&nbsp;↗
            </a>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
