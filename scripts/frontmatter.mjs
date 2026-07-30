/**
 * frontmatter.mjs — split a leading `---` YAML frontmatter block from an
 * MDX/MDX-like document. One definition for the build scripts, which had the
 * same `^---\n…\n---\n` regex written out in several places.
 *
 * Returns { fm, body }: `fm` is the YAML text between the fences (null when the
 * document has no leading block), `body` is everything after the closing fence
 * (the whole document when there is no block). A generated module always has a
 * body after its frontmatter, so the closing `\n---\n` form matches every real
 * input; a frontmatter-only document (no trailing newline) reads as no block.
 */
export function splitFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : { fm: null, body: raw };
}
