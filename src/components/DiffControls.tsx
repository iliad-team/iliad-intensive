/**
 * The diff view's controls row. Inert markup: public/diff.js finds these
 * elements by id and owns them, and globals.css hides the row on a page
 * without a worksheet article. Rendered by the PR-preview banner ("diff vs
 * main") and by /dev/diff (two snapshots of one page).
 *
 * `toggleData` goes onto the #diff-toggle checkbox as data-* attributes, which
 * is how each host tells diff.js where the base article comes from and what to
 * call the two columns (see the top of public/diff.js).
 */
export function DiffControls({
  label,
  toggleData,
  className = "",
}: {
  label: string;
  toggleData: Record<`data-${string}`, string>;
  className?: string;
}) {
  const control =
    "rounded border border-amber-600/40 bg-amber-300/60 px-2 py-0.5 leading-tight " +
    "transition-colors hover:border-amber-700 hover:bg-amber-300";
  return (
    <div
      id="diff-controls"
      className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pb-2 pt-1.5 text-xs ${className}`}
    >
      <label className="inline-flex cursor-pointer items-center gap-1">
        <input type="checkbox" id="diff-toggle" {...toggleData} />
        {label}
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
      {/* Off by default, and independent of the diff: a red line down the
          right edge of every article column, and a dashed red outline on each
          display equation that is wider than the column, so an overflow is
          seen rather than scrolled past (markOverflow in public/diff.js). */}
      <label id="diff-edge-label" className="inline-flex cursor-pointer items-center gap-1">
        <input type="checkbox" id="diff-edge" />
        show column edge
        <span id="diff-edge-count" className="text-amber-900/80" />
      </label>
      {/* Steps through the changes in position order; turns the diff on
          first if it is off. */}
      <button type="button" id="diff-next" className={control}>
        next change&nbsp;▸
      </button>
      <span id="diff-status" className="italic text-amber-900/80" />
    </div>
  );
}
