import { notFound } from "next/navigation";
import { listDownloads, listIndex, listSlugs, readModuleMdx } from "@/lib/content";
import { clusterUrlSlug } from "@/lib/clusters";
import { listClusters } from "@/lib/cluster-store";
import { MdxBody } from "@/lib/mdx";
import { ModulePageShell } from "@/components/ModulePageShell";
import { SidebarNav } from "@/components/SidebarNav";
import { DownloadsRow } from "@/components/DownloadsRow";

// Static export: every .mdx in content/modules is prerendered at build time.
// content/index.json only controls the homepage/sidebar listing, so a module
// missing from the index is built but unlisted (reachable only by URL).
export const dynamicParams = false;

// Evaluated once during `next build` — pages are static, so this is the
// moment the deployed page was actually built.
const BUILT_AT = new Date().toLocaleString("en-GB", {
  day: "numeric", month: "long", year: "numeric",
  hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false,
}) + " UTC";

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

  const [mod, modules, clusterList, downloads] = await Promise.all([
    readModuleMdx(slug),
    listIndex(),
    listClusters(),
    listDownloads(slug),
  ]);

  if (!mod) notFound();

  // Only the canonical cluster segment exists in a static build.
  const actualClusterSlug = clusterUrlSlug(mod.frontmatter.cluster, clusterList);
  if (actualClusterSlug !== clusterParam) notFound();

  const fm = mod.frontmatter;

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
          {fm.cluster && (
            <div className="font-sans mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-wide text-zinc-500">
              <span>Cluster {fm.cluster}</span>
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
          />
        </header>
        <div className="prose">
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
          .
        </footer>
      </article>
    </ModulePageShell>
  );
}
