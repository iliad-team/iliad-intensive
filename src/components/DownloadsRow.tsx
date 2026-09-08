import type { ReactNode } from "react";
import type { Frontmatter, StagedDeck } from "@/lib/content";

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
 * download boxes, plus one Slides row per deck. `files` is the build-time
 * listing of public/downloads/<slug>/; the checkbox swaps the worksheet rows
 * between <slug>.<ext> and <slug>-nosol.<ext> (all pre-generated build
 * artifacts). Slides carry no solutions variant and are unaffected by the
 * toggle.
 *
 * Decks stack, in a fixed order: the externally hosted one first (`slides` —
 * the frontmatter `slides:` key, a URL or `{url, title}` — linked, never
 * hosted here), then every compiled deck (`decks`, from listDecks: slides.tex,
 * then slides-<label>.tex by filename). A day whose main lecture exists only
 * as a hosted deck and whose guest lecture compiles from source shows both.
 * With more than one row the deck's title (its own \title{}, or the `slides:`
 * title) follows the boxes so a reader can tell them apart; a lone deck stays
 * unlabelled, as it always was.
 *
 * A deck that opted into a collapsed build ships <slug>-<stem>-handout.pdf
 * too; its row then reads present · handout · LaTeX instead of the
 * view · download · LaTeX it shows for a single-variant deck.
 *
 * Server-rendered: the with/without-solutions swap is public/site.js reading
 * the data-sol/data-nosol pairs off each link — no React on the client.
 */
export function DownloadsRow({
  slug,
  files,
  basePath,
  decks = [],
  slides,
}: {
  slug: string;
  files: string[];
  basePath: string;
  decks?: StagedDeck[];
  slides?: Frontmatter["slides"];
}) {
  const href = (file: string) => `${basePath}/downloads/${slug}/${file}`;
  const exts = (["pdf", "tex", "mdx"] as const).filter((ext) => files.includes(`${slug}.${ext}`));

  const external = typeof slides === "string" ? { url: slides, title: undefined } : slides?.url ? slides : null;
  const deckRows = (external ? 1 : 0) + decks.length;

  if (exts.length === 0 && deckRows === 0) return null;

  const rowLabel = "w-20 shrink-0 uppercase tracking-wide text-zinc-500";
  const deckTitle = (title?: string | null) =>
    deckRows > 1 && title ? <span className="text-zinc-500">{title}</span> : null;

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

        {external && (
          <li className="flex items-center gap-2">
            <span className={rowLabel}>Slides</span>
            <a
              href={external.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-zinc-300 px-2 py-0.5 lowercase tracking-normal text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-900"
            >
              open&nbsp;↗
            </a>
            {deckTitle(external.title)}
          </li>
        )}

        {decks.map((deck) => (
          <li key={deck.stem} className="flex items-center gap-2">
            <span className={rowLabel}>Slides</span>
            {deck.handout ? (
              <>
                <Box href={href(`${slug}-${deck.stem}.pdf`)}>present</Box>
                <Box href={href(`${slug}-${deck.stem}-handout.pdf`)}>handout</Box>
              </>
            ) : (
              <>
                <Box href={href(`${slug}-${deck.stem}.pdf`)}>view</Box>
                <Box href={href(`${slug}-${deck.stem}.pdf`)} download>download</Box>
              </>
            )}
            {deck.tex && (
              <Box href={href(`${slug}-${deck.stem}.tex`)} download>LaTeX</Box>
            )}
            {deckTitle(deck.title)}
          </li>
        ))}
      </ul>
    </div>
  );
}
