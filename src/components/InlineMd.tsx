import ReactMarkdown from "react-markdown";

/**
 * Render a single line of markdown without wrapping <p>. Used for short
 * frontmatter-sourced strings (e.g. learningOutcomes bullets) where the
 * author has used **bold**, *italic*, `code`, or [links].
 */
export function InlineMd({ text }: { text: string }) {
  return (
    <ReactMarkdown
      components={{
        // Drop the wrapping <p> so we render inline inside a list item.
        p: ({ children }) => <>{children}</>,
        a: ({ href, children }) => (
          <a href={href} className="text-[var(--link)] underline">
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-black/5 px-1 text-[0.92em]">{children}</code>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
