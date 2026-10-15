# Worksheet metadata

What goes at the top of `tex/<slug>/main.tex`. For every other construct see
[`commands.md`](commands.md).

## Required

`\title{}` and `\author{}`. The build warns if either is missing but still
builds. Affiliations are supported:

```latex
\author{
  \authorname{Jane Doe}\\
  \affiliation{Institute of Science}
  \and
  \authorname{John Doe}\\
  \affiliation{Nowhere University}
}
```

## The `%--- iliad ---` block

A comment block at the very top of `main.tex`, holding YAML:

```latex
%--- iliad ---
% summary: >-
%   One paragraph on what this sheet is about, indented two spaces
%   after the `% `. Line breaks fold into spaces.
%--- end ---
```

| Key | Effect |
|---|---|
| `summary` | Shown in the page index and under the page title. |
| `title`, `contributors` | Override what is extracted from `\title`/`\author`. |
| `slides` | URL of an externally hosted deck with no source (PDF only). Rendered as its own Slides row, beside any compiled `slides*.tex`. With several decks, write it as `url:` + `title:` to name the row. |

Cluster and teaching day are **not** keys here. List the slug under its day in
[`schedule.yaml`](../schedule.yaml) and the build fills both in.

## Learning outcomes

```latex
\begin{learningoutcomes}
\begin{itemize}
\item ...
\end{itemize}
\end{learningoutcomes}
```

Renders as a "What you'll learn" box. Place it after Prerequisites (fixed order:
[`commands.md` § Front matter opens the sheet](commands.md#front-matter-opens-the-sheet)).
On a long sheet, group outcomes under `\subsection*{...}` headings, each with
its own `itemize`.
