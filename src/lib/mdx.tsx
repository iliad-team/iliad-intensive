/**
 * MDX renderer. The component and attribute NAMES match what the tex -> mdx
 * converter emits (the same catalogue as the curriculum admin's
 * src/lib/mdx/render.tsx); the styling here is this site's own and
 * intentionally diverges from the admin/public-site look.
 */
import { compileMDX } from "next-mdx-remote/rsc";
import { createHash } from "node:crypto";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import "katex/dist/katex.min.css";
import type { ReactNode } from "react";

// basePath is applied automatically to <Link>/CSS/fonts but NOT to raw
// <img src> attributes, so Figure prefixes it explicitly. Inlined at build
// time (NEXT_PUBLIC_), empty for local dev / root-domain hosting.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const components = {
  /**
   * Callout — coloured side-note for an important remark, warning, or tip.
   * Usage: <Callout type="note|warning|tip">body</Callout>
   */
  Callout: ({
    type = "note",
    children,
  }: {
    type?: "note" | "warning" | "tip";
    children: ReactNode;
  }) => (
    <div
      className={
        "my-4 rounded-md border-l-4 px-4 py-3 " +
        (type === "warning"
          ? "border-amber-500 bg-amber-50"
          : type === "tip"
            ? "border-emerald-500 bg-emerald-50"
            : "border-sky-500 bg-sky-50")
      }
    >
      {children}
    </div>
  ),

  /**
   * Exercise — boxed practice problem with 1–5 difficulty stamp.
   * Usage: <Exercise difficulty={N} id="optional-anchor">problem</Exercise>
   * The optional `id` makes the box a link target for cross-references,
   * e.g. [Problem 2.2](#prob-2-2) — the MDX equivalent of LaTeX \cref.
   */
  Exercise: ({
    difficulty = 1,
    id,
    children,
  }: {
    difficulty?: number;
    id?: string;
    children: ReactNode;
  }) => (
    <section id={id} className="my-6 border border-orange-300 bg-orange-50 rounded-md p-4">
      <header className="text-sm uppercase tracking-wide text-orange-700 mb-2">
        Exercise · difficulty {difficulty}/5
      </header>
      <div>{children}</div>
    </section>
  ),

  /**
   * Solution — collapsible answer that follows an Exercise.
   * Usage: <Solution>worked answer</Solution>
   * The optional `title` relabels the summary — e.g. <Solution title="Proof">
   * for collapsible proofs (the tex->mdx converter emits these).
   */
  Solution: ({ title = "Solution", children }: { title?: string; children: ReactNode }) => (
    <details className="my-3 rounded-md border border-zinc-200 px-3 py-2">
      <summary className="cursor-pointer font-medium">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  ),

  /**
   * Definition — named-concept box, exercise-style: the term lives in the
   * header stamp ("Definition 2.1 · entropy"), the body is just the text.
   * Usage: <Definition term="RLCT" num="1.2" id="optional-anchor">Real Log Canonical Threshold; see Watanabe.</Definition>
   */
  Definition: ({ term, num, id, children }: { term: string; num?: string; id?: string; children: ReactNode }) => (
    <section
      id={id}
      className="my-4 rounded-md border border-indigo-300 bg-indigo-50 px-4 py-3"
      data-component="definition"
    >
      <header className="text-xs uppercase tracking-wider text-indigo-700">
        Definition
        {num ? ` ${num}` : ""}
        {term ? ` · ${term}` : ""}
      </header>
      {/* Block-safe wrapper: definition bodies may contain paragraphs, lists,
          or display math (block elements), which are invalid inside <p>/<span>
          and cause a "<p> cannot be a descendant of <p>" hydration error. */}
      <div className="mt-1">{children}</div>
    </section>
  ),

  /**
   * Theorem — formal statement.
   * Usage: <Theorem kind="theorem|lemma|proposition|corollary" name="optional attribution" id="optional-anchor">statement</Theorem>
   */
  Theorem: ({
    kind = "theorem",
    name,
    num,
    id,
    children,
  }: {
    kind?: "theorem" | "lemma" | "proposition" | "corollary";
    name?: string;
    num?: string;
    id?: string;
    children: ReactNode;
  }) => {
    const label = kind.charAt(0).toUpperCase() + kind.slice(1);
    return (
      <section
        id={id}
        className="my-5 border-l-4 border-violet-500 bg-violet-50 px-4 py-3 rounded-r"
        data-component="theorem"
      >
        <header className="text-xs uppercase tracking-wider text-violet-700">
          {label}
          {num ? ` ${num}` : ""}
          {name ? ` · ${name}` : ""}
        </header>
        <div className="mt-1 italic">{children}</div>
      </section>
    );
  },

  /**
   * Figure — image with caption.
   * Usage: <Figure src="/uploads/<slug>/file.png" alt="..." caption="..." />
   */
  Figure: ({ src, alt, caption }: { src: string; alt?: string; caption?: string }) => (
    <figure className="my-6 text-center" data-component="figure">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src.startsWith("/") ? `${BASE_PATH}${src}` : src}
        alt={alt ?? caption ?? ""}
        loading="lazy"
        decoding="async"
        className="mx-auto h-auto max-w-full rounded"
      />
      {caption ? (
        <figcaption className="mt-2 text-sm text-zinc-600">{caption}</figcaption>
      ) : null}
    </figure>
  ),
};

// Compiled-output cache keyed on a hash of the raw MDX source. Pages are
// prerendered at build time, but `next dev` re-reads content from disk on
// every request; an unchanged file yields the same source and is served from
// this cache, so the heavy remark/rehype + KaTeX render only runs when the
// file actually changes.
const compiledCache = new Map<string, ReactNode>();

export async function MdxBody({ source }: { source: string }) {
  const key = createHash("sha1").update(source).digest("hex");
  let content = compiledCache.get(key);
  if (!content) {
    const compiled = await compileMDX({
      source,
      components,
      options: {
        mdxOptions: {
          remarkPlugins: [remarkMath],
          // rehypeSlug before rehypeKatex so slugs come from plain heading text.
          // `macros: {}` is a fresh per-compile object: a page's own `\gdef`
          // macros persist across its math blocks but never leak between pages.
          rehypePlugins: [rehypeSlug, [rehypeKatex, { strict: false, macros: {} }]],
        },
      },
    });
    content = compiled.content;
    compiledCache.set(key, content);
    // Bound memory: drop the oldest entry once the cache grows past ~64 pages.
    if (compiledCache.size > 64) {
      compiledCache.delete(compiledCache.keys().next().value as string);
    }
  }
  return content;
}
