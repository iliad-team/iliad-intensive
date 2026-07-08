import { notFound } from "next/navigation";
import { listIndex, listSlugs, readModuleMdx } from "@/lib/content";
import { clusterUrlSlug } from "@/lib/clusters";
import { listClusters } from "@/lib/cluster-store";
import { MdxBody } from "@/lib/mdx";
import { ModulePageShell } from "@/components/ModulePageShell";
import { SidebarNav } from "@/components/SidebarNav";
import { InlineMd } from "@/components/InlineMd";

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

  const [mod, modules, clusterList] = await Promise.all([
    readModuleMdx(slug),
    listIndex(),
    listClusters(),
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
          {/* Downloads: build artifacts emitted by scripts/build-content.mjs.
              Plain <a> tags — static files bypass Next's router, so the
              basePath prefix is applied manually. */}
          <p className="mt-3 flex gap-x-4 font-sans text-xs uppercase tracking-wide">
            {(["pdf", "tex", "mdx"] as const).map((ext) => (
              <a
                key={ext}
                href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/downloads/${slug}/${slug}.${ext}`}
                className="text-zinc-500 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-800"
                download
              >
                {ext === "pdf" ? "PDF" : ext === "tex" ? "LaTeX" : "Markdown"}
              </a>
            ))}
          </p>
          {fm.learningOutcomes && fm.learningOutcomes.length > 0 && (
            <section className="mt-6 rounded border border-zinc-200 bg-white/60 p-4">
              <h2 className="font-sans text-xs uppercase tracking-[0.15em] text-zinc-500">
                What you&rsquo;ll learn
              </h2>
              <ul className="mt-2 list-disc pl-5 font-serif text-[1rem] leading-relaxed text-zinc-800 space-y-1">
                {fm.learningOutcomes.map((o, i) => (
                  <li key={i}>
                    <InlineMd text={o} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </header>
        <div className="prose">
          <MdxBody source={mod.body} />
        </div>
      </article>
    </ModulePageShell>
  );
}
