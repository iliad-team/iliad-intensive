// slides-typst.typ — the kitchen sink's Typst deck. A deck may be written in
// Typst instead of LaTeX: same stems (slides.typ, slides-<label>.typ), one
// `typst compile`, the .typ offered for download where a LaTeX deck offers its
// .tex. This one exists so the pipeline's Typst path is exercised on every
// build; see docs/commands.md §Slides.
//
// `document(title:)` is what labels the row when a page has several decks —
// the Typst counterpart of beamer's \title{}.
#set document(title: "Example Typst deck")
#set page(width: 16cm, height: 9cm, margin: 1.2cm, fill: rgb("#f7f3e8"))
#set text(size: 14pt)

#align(center + horizon)[
  #text(size: 26pt, weight: "bold")[Example Typst deck]
  #v(0.6em)
  #text(size: 12pt, fill: luma(40%))[built by `typst compile`, hosted beside the worksheet]
]

#pagebreak()

= What this deck shows

- Typst maths renders and embeds its own fonts: $ integral_0^1 x^2 dif x = 1/3 $
- Figures live in `fig/`, referenced relatively — the same folder the worksheet uses:

#align(center)[#image("fig/value-curve.pdf", width: 45%)]
