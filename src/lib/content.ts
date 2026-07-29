import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

/** Frontmatter of a *generated* module. `cluster`/`day` are stamped in by
 *  build-content.mjs from schedule.yaml (an author may not write either); the
 *  rest come from the worksheet's own source. */
export type Frontmatter = {
  title?: string;
  cluster?: string;
  difficulty?: number;
  importance?: number;
  timeMinutes?: number;
  contributors?: string[];
  summary?: string;
  /** External slide-deck URL (e.g. a Drive PDF); rendered as an outbound
   *  link. A compiled slides.pdf (from slides.tex) takes precedence. */
  slides?: string;
  /** Teaching day this worksheet is the material for, e.g. "B.4". Several
   *  worksheets may share one day. */
  day?: string;
};

export type HeadingEntry = {
  level: 2 | 3 | 4;
  text: string;
  slug: string;
};

export type IndexEntry = {
  slug: string;
  title: string;
  cluster: string | null;
  /** Teaching day code, e.g. "D.3". Several worksheets may share one. */
  day?: string;
  /** 1-based place within this sheet's own day, and how many the day has.
   *  Together they give the display code (D.3.1) — see dayCode() in
   *  ./clusters.ts. `day` above stays the canonical, undotted identity. */
  part?: number;
  parts?: number;
  /** 1-based place in the curriculum, straight out of schedule.yaml's order
   *  (cluster, then day, then the day's own worksheet order). */
  position?: number;
  frontmatter: Frontmatter;
  headings?: HeadingEntry[];
};

const CONTENT_DIR = path.join(process.cwd(), "content", "modules");
const INDEX_FILE = path.join(process.cwd(), "content", "index.json");
const DOWNLOADS_DIR = path.join(process.cwd(), "public", "downloads");

/**
 * Files available under public/downloads/<slug>/ — build artifacts from
 * scripts/build-content.mjs. LaTeX-authored sheets have pdf+tex+mdx;
 * MDX-authored sheets have pdf+mdx.
 */
export async function listDownloads(slug: string): Promise<string[]> {
  try {
    const files = await readdir(path.join(DOWNLOADS_DIR, slug));
    return files.filter((f) => !f.startsWith(".")).sort();
  } catch {
    return [];
  }
}

export async function listIndex(): Promise<IndexEntry[]> {
  try {
    const raw = await readFile(INDEX_FILE, "utf8");
    return JSON.parse(raw) as IndexEntry[];
  } catch {
    return [];
  }
}

/**
 * Every .mdx file in content/modules gets a page, whether or not it is in
 * content/index.json — the index only controls what the homepage and sidebar
 * list. Files absent from the index are reachable but unlisted.
 */
export async function listSlugs(): Promise<string[]> {
  try {
    const files = await readdir(CONTENT_DIR);
    const slugs = files.filter((f) => f.endsWith(".mdx")).map((f) => f.replace(/\.mdx$/, ""));
    // Preview optimization (./run.sh preview <slug>): when PREVIEW_ONLY is set,
    // only that worksheet's page is statically generated, so a rebuild renders
    // just the section you edited instead of every module. Never set in a real
    // build, so production/deploy output is unaffected.
    const only = process.env.PREVIEW_ONLY;
    return only ? slugs.filter((s) => s === only) : slugs;
  } catch {
    return [];
  }
}

export async function readModuleMdx(slug: string): Promise<{
  raw: string;
  frontmatter: Frontmatter;
  body: string;
} | null> {
  try {
    const raw = await readFile(path.join(CONTENT_DIR, `${slug}.mdx`), "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) return { raw, frontmatter: {}, body: raw };
    const parsed: Frontmatter = (YAML.parse(m[1]) as Frontmatter | null) ?? {};
    return { raw, frontmatter: parsed, body: m[2] };
  } catch {
    return null;
  }
}
