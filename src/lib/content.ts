import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export type Frontmatter = {
  title?: string;
  cluster?: string;
  difficulty?: number;
  importance?: number;
  timeMinutes?: number;
  contributors?: string[];
  summary?: string;
  learningOutcomes?: string[];
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
  position?: number;
  frontmatter: Frontmatter;
  headings?: HeadingEntry[];
};

const CONTENT_DIR = path.join(process.cwd(), "content", "modules");
const INDEX_FILE = path.join(process.cwd(), "content", "index.json");

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
    return files.filter((f) => f.endsWith(".mdx")).map((f) => f.replace(/\.mdx$/, ""));
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
