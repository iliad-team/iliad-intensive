import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { Cluster } from "@/lib/clusters";
import { moduleHref } from "@/lib/preview";

/**
 * The tint a worksheet the PR touched wears on the homepage and in the sidebar
 * of a PR preview. Lives in a .tsx file so Tailwind's source scan emits it.
 */
export const CHANGED_TINT = "rounded bg-emerald-200/80 px-1.5 -mx-1.5 box-decoration-clone";

/**
 * A link to a worksheet page. <Link> into this build when the page is in it; a
 * plain <a> to the live site when a partial PR preview left it out (see
 * src/lib/preview.ts — <Link> would prefix the base path and 404).
 *
 * prefetch is always off: every listing that uses this names the whole
 * curriculum, and prefetching each worksheet's multi-MB payload as its link
 * scrolls into view is bandwidth spent on pages nobody clicked.
 */
export function ModuleLink({
  cluster, slug, clusters, className, style, title, children,
}: {
  cluster: string | null | undefined;
  slug: string;
  clusters: Cluster[];
  className?: string;
  style?: CSSProperties;
  title?: string;
  children: ReactNode;
}) {
  const { href, live } = moduleHref(cluster, slug, clusters);
  if (live) {
    return (
      <a
        href={href}
        className={className}
        style={style}
        title={title ?? "Unchanged in this pull request — opens the live site"}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} prefetch={false} className={className} style={style} title={title}>
      {children}
    </Link>
  );
}
