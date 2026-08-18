import Link from "next/link";
import { notFound } from "next/navigation";
import { listDownloads, listIndex, listSlugs, readModuleMdx } from "@/lib/content";
import { clusterUrlSlug, dayCode } from "@/lib/clusters";
import { listClusters, listDays } from "@/lib/cluster-store";
import { MdxBody } from "@/lib/mdx";
import { MathJaxSetup } from "@/components/MathJaxSetup";
import { ModulePageShell } from "@/components/ModulePageShell";
import { SidebarNav } from "@/components/SidebarNav";
import { DownloadsRow } from "@/components/DownloadsRow";
import { BUILT_AT, COMMIT_SHA, CommitLink } from "@/components/BuildStamp";

// Static export: every .mdx in content/modules is prerendered at build time.
// content/index.json only controls the homepage/sidebar listing, so a module
// missing from the index is built but unlisted (reachable only by URL).
export const dynamicParams = false;

export async function generateStaticParams() {
  const [slugs, clusterList] = await Promise.all([listSlugs(), listClusters()]);
  const params = [];
  for (const slug of slugs) {
    const mod = await readModuleMdx(slug);
    if (!mod) continue;
    params.push({
      cluster: clusterUrlSlug(mod.frontmatter.cluster, clusterList),
      slug,
    });
  }
  return params;
}

export default async function ModulePage({
  params,
}: {
  params: Promise<{ cluster: string; slug: string }>;
}) {
  const { cluster: clusterParam, slug } = await params;

  const [mod, modules, clusterList, days, downloads] = await Promise.all([
    readModuleMdx(slug),
    listIndex(),
    listClusters(),
    listDays(),
    listDownloads(slug),
  ]);

  if (!mod) notFound();

  // Only the canonical cluster segment exists in a static build.
  const actualClusterSlug = clusterUrlSlug(mod.frontmatter.cluster, clusterList);
  if (actualClusterSlug !== clusterParam) notFound();

  const fm = mod.frontmatter;

  // Which teaching day this page belongs to, and which part of it. `part`/`parts`
  // live in the index (they are curriculum facts, not the sheet's own), so read
  // them off this page's own index entry; the day's title comes from the same
  // schedule.yaml the index was ordered by.
  const entry = modules.find((m) => m.slug === slug);
  const code = dayCode(fm.day ?? entry?.day, entry?.part, entry?.parts);
  const title = days.find((d) => d.code === (fm.day ?? entry?.day))?.title;
  const dayLabel = code && title ? `${code} · ${title}` : code;

  return (
    <ModulePageShell sidebar={<SidebarNav modules={modules} activeSlug={slug} clusters={clusterList} />}>
      <article>
        <header className="not-prose mb-6 border-b border-zinc-200 pb-4">
          <h1
            className="font-serif text-[2.1rem] leading-[1.15] tracking-tight"
            style={{ fontWeight: 600 }}
          >
            {fm.title ?? slug}
          </h1>
          {(fm.cluster || dayLabel) && (
            <div className="font-sans mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-wide text-zinc-500">
              {fm.cluster && <span>Cluster {fm.cluster}</span>}
              {/* Which teaching day this page is part of. Arriving from search,
                  a worksheet otherwise has no context — and when a day is taught
                  in several parts, being part 2 of D.3 is the first thing worth
                  knowing about the page. */}
              {dayLabel && (entry?.parts && entry.parts > 1 ? (
                <Link href={`/#${entry.day}`} className="hover:text-zinc-800 hover:underline">
                  {dayLabel}
                </Link>
              ) : (
                <span>{dayLabel}</span>
              ))}
            </div>
          )}
          {fm.summary && (
            <p className="mt-5 font-serif text-[1.08rem] italic leading-relaxed text-zinc-700">
              {fm.summary}
            </p>
          )}
          {fm.contributors && fm.contributors.length > 0 && (
            <p className="mt-3 font-sans text-sm text-zinc-600">
              <span className="text-zinc-500">By </span>
              {fm.contributors.join(", ")}
            </p>
          )}
          {/* Downloads: build artifacts from scripts/build-content.mjs, each
              in a with-solutions and -nosol variant. The row only offers what
              exists (MDX-authored sheets have no .tex). */}
          <DownloadsRow
            slug={slug}
            files={downloads}
            basePath={process.env.NEXT_PUBLIC_BASE_PATH ?? ""}
            slidesUrl={fm.slides}
          />
        </header>
        <div className="prose">
          <MathJaxSetup source={mod.body} />
          <MdxBody source={mod.body} />
        </div>
        <footer className="not-prose mt-12 border-t border-zinc-200 pt-4 font-sans text-xs text-zinc-500">
          Built {BUILT_AT}
          {(() => {
            // Link the file the page was actually built from: the LaTeX
            // source when it exists, else the authored MDX.
            const src = downloads.includes(`${slug}.tex`)
              ? `${slug}.tex`
              : downloads.includes(`${slug}.mdx`)
                ? `${slug}.mdx`
                : null;
            return src ? (
              <>
                {" from "}
                <a
                  href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/downloads/${slug}/${src}`}
                  className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800"
                >
                  {src}
                </a>
              </>
            ) : null;
          })()}
          {COMMIT_SHA ? <> · <CommitLink /></> : null}.
        </footer>
      </article>
    </ModulePageShell>
  );
}
