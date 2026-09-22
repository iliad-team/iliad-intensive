import { CHANGED, PARTIAL } from "@/lib/preview";

// Shown ONLY on per-PR preview builds. CI sets NEXT_PUBLIC_PREVIEW_PR to the PR
// number for preview deploys (see .github/workflows/site.yml); production builds
// leave it unset, so this renders nothing there. Values are inlined at build
// time (NEXT_PUBLIC_* → client bundle), so it works under `output: export`.
const PR = process.env.NEXT_PUBLIC_PREVIEW_PR;

// The PR's title, so a reader with several preview tabs open can tell WHICH
// change each one is showing. Optional on purpose: previews built before this
// existed, or by anything that does not set it, still get the banner without
// its title rather than the word "undefined".
const PR_TITLE = process.env.NEXT_PUBLIC_PREVIEW_PR_TITLE?.trim();

// A preview built by hand (NEXT_PUBLIC_PREVIEW_PR=local) has no PR to link.
const IS_PR = !!PR && /^\d+$/.test(PR);

// The diff view (public/diff.js) fetches the base version of each page from
// here + the page's path. Empty = this origin's root, which is where the
// production site lives relative to /pr-preview/pr-N/. A local build sets it
// to https://iliad-intensive.org (which allows cross-origin reads).
const DIFF_BASE = process.env.NEXT_PUBLIC_DIFF_BASE ?? "";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Fixed project locations.
const LIVE_URL = "https://iliad-intensive.org/";
const REPO_URL = "https://github.com/iliad-team/iliad-intensive";

/**
 * Two rows, and the whole thing sticks to the top of the viewport together
 * with the navbar (layout.tsx wraps both in #top-stack on previews):
 *
 *   1. what this is — the PR, its title, the way out to the live site — and,
 *      on a partial preview, how many worksheet pages it carries;
 *   2. the diff view's controls. Inert markup: public/diff.js owns them, and
 *      globals.css hides the row on pages without a worksheet article.
 */
export function PreviewBanner() {
  if (!PR) return null;
  const prUrl = `${REPO_URL}/pull/${PR}`;
  const n = CHANGED.size;
  const control =
    "rounded border border-amber-600/40 bg-amber-300/60 px-2 py-0.5 leading-tight " +
    "transition-colors hover:border-amber-700 hover:bg-amber-300";
  return (
    <div role="alert" className="w-full bg-amber-400 text-amber-950 font-sans text-sm">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pb-1 pt-2 text-center">
        <span className="font-medium">
          {IS_PR ? <>⚠ Preview of pull request #{PR}</> : <>⚠ Local preview build</>}
          {PR_TITLE && (
            <>
              {" — "}
              {/* Rendered as text, so React escapes it: a PR title is chosen by
                  whoever opened the PR and must never become markup. Clamped
                  because a long title would otherwise push the links off a
                  narrow screen; the full text stays available on hover and to a
                  screen reader. */}
              <span
                className="inline-block max-w-[min(60ch,100%)] overflow-hidden text-ellipsis whitespace-nowrap align-bottom italic"
                title={PR_TITLE}
              >
                {PR_TITLE}
              </span>
            </>
          )}
          {" — this is not the live site."}
        </span>
        <span className="flex flex-wrap items-center justify-center gap-x-4">
          <a className="underline underline-offset-2 font-medium" href={LIVE_URL}>
            Go to the live site&nbsp;↗
          </a>
          {IS_PR && (
            <a
              className="underline underline-offset-2 font-medium"
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open PR #{PR}&nbsp;↗
            </a>
          )}
        </span>
        {/* A partial preview says what it holds, so an "unchanged" link that
            leaves the banner behind is expected rather than surprising. */}
        {PARTIAL && (
          <span className="text-xs text-amber-900/90">
            {n === 0
              ? "No worksheet pages changed in this PR — every worksheet link opens the live site."
              : `${n} worksheet page${n === 1 ? "" : "s"} changed in this PR (highlighted in green) — every other worksheet link opens the live site.`}
          </span>
        )}
      </div>
      {/* The diff view's controls. Inert markup: public/diff.js owns them and
          hides the whole row on pages without a worksheet article. */}
      <div
        id="diff-controls"
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-amber-600/30 px-4 pb-2 pt-1.5 text-xs"
      >
        <label className="inline-flex cursor-pointer items-center gap-1">
          <input
            type="checkbox"
            id="diff-toggle"
            data-diff-base={DIFF_BASE}
            data-base-path={BASE_PATH}
          />
          diff vs main
        </label>
        <label id="diff-sync-label" className="inline-flex cursor-pointer items-center gap-1">
          <input type="checkbox" id="diff-sync" defaultChecked />
          sync scroll
        </label>
        {/* On by default: unchanged sections and blocks fold into clickable
            strips (one per section, named by its heading), one block of context
            kept beside each change, so a long sheet reads as its changes. */}
        <label id="diff-hide-label" className="inline-flex cursor-pointer items-center gap-1">
          <input type="checkbox" id="diff-hide" defaultChecked />
          hide unchanged
        </label>
        {/* Off by default: each diff column is then exactly as wide as the
            page's own column, so an equation that runs off the real page runs
            off here too. On, the columns share the viewport and hide it. */}
        <label id="diff-stretch-label" className="inline-flex cursor-pointer items-center gap-1">
          <input type="checkbox" id="diff-stretch" />
          allow stretched margins
        </label>
        {/* Steps through the changes in position order; turns the diff on
            first if it is off. */}
        <button type="button" id="diff-next" className={control}>
          next change&nbsp;▸
        </button>
        <span id="diff-status" className="italic text-amber-900/80" />
      </div>
    </div>
  );
}
