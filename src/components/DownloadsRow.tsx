"use client";

import { useState } from "react";

const LABELS: Record<string, string> = { pdf: "PDF", tex: "LaTeX", mdx: "Markdown" };

/**
 * Download links with a with/without-solutions toggle. `files` is the
 * build-time listing of public/downloads/<slug>/; the checkbox swaps every
 * link between <slug>.<ext> and <slug>-nosol.<ext> (all pre-generated build
 * artifacts — nothing is computed on the fly).
 */
export function DownloadsRow({
  slug,
  files,
  basePath,
}: {
  slug: string;
  files: string[];
  basePath: string;
}) {
  const [solutions, setSolutions] = useState(true);
  if (files.length === 0) return null;
  const name = (ext: string) => `${slug}${solutions ? "" : "-nosol"}.${ext}`;
  const exts = (["pdf", "tex", "mdx"] as const).filter((ext) => files.includes(name(ext)));
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-xs uppercase tracking-wide">
      {exts.map((ext) => (
        <a
          key={ext}
          href={`${basePath}/downloads/${slug}/${name(ext)}`}
          className="text-zinc-500 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-800"
          title={name(ext)}
          download
        >
          {LABELS[ext]}
          {solutions ? "" : " (no solutions)"}
        </a>
      ))}
      <label className="flex cursor-pointer select-none items-center gap-1.5 normal-case tracking-normal text-zinc-500">
        <input
          type="checkbox"
          checked={solutions}
          onChange={(e) => setSolutions(e.target.checked)}
          className="accent-zinc-600"
        />
        with solutions
      </label>
    </p>
  );
}
