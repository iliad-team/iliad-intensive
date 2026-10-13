import assert from "node:assert/strict";
import test from "node:test";
import { numberMath } from "./math-numbering.mjs";

const refs = { "eq:degeneracy": { num: "19" }, a: { num: "4.2a" }, b: { num: "4.2b" } };

test("SLT's referenced equation uses its aux number", () => {
  assert.equal(numberMath("equation", String.raw`\label{eq:degeneracy} D_v \Phi(w) = 0.`, refs),
    String.raw`\label{eq:degeneracy} D_v \Phi(w) = 0. \tag{19}`);
});

test("starred, unnumbered, missing and explicit numbers are preserved", () => {
  for (const name of ["equation*", "align*", "gather*", "displaymath"]) {
    const body = String.raw`x=0\label{a}`;
    assert.equal(numberMath(name, body, refs), body);
  }
  for (const body of [String.raw`x=0`, String.raw`x=0\label{missing}`,
    String.raw`x=0\label{a}\tag{custom}`, String.raw`x=0\label{a}\tag*{custom}`,
    String.raw`x=0\label{a}\notag`, String.raw`x=0\label{a}\nonumber`]) {
    assert.equal(numberMath("equation", body, refs), body);
  }
});

test("single equation with nested rows gets one tag", () => {
  const body = String.raw`\begin{split}x&=1\\y&=2\end{split}\label{a}`;
  assert.equal(numberMath("equation", body, refs), body + String.raw` \tag{4.2a}`);
  assert.equal(numberMath("multline", String.raw`x+\\y\label{b}`, refs),
    String.raw`x+\\y\label{b} \tag{4.2b}`);
});

test("outer rows get their own aux numbers, including intertext and spacing", () => {
  for (const name of ["align", "alignat", "gather"]) {
    const body = String.raw`x&=1\label{a}\\[2pt]\intertext{Then}y&=2\label{b}`;
    assert.equal(numberMath(name, body, refs),
      String.raw`x&=1\label{a} \tag{4.2a}\\[2pt]\intertext{Then}y&=2\label{b} \tag{4.2b}`);
  }
});

test("nested environments and brace groups do not split an outer row", () => {
  for (const nested of [String.raw`\begin{pmatrix}1\\2\end{pmatrix}`,
    String.raw`{\substack{1\\2}}`, String.raw`\begin{cases}1&x\\2&y\end{cases}`]) {
    const body = nested + String.raw`\label{a}\\z\label{b}`;
    assert.equal(numberMath("align", body, refs),
      nested + String.raw`\label{a} \tag{4.2a}\\z\label{b} \tag{4.2b}`);
  }
});

test("suppressed rows and aliases do not acquire extra tags", () => {
  assert.equal(numberMath("align", String.raw`x\label{a}\notag\\y\label{b}`, refs),
    String.raw`x\label{a}\notag\\y\label{b} \tag{4.2b}`);
  assert.equal(numberMath("equation", String.raw`x\label{a}\label{b}`, refs),
    String.raw`x\label{a}\label{b} \tag{4.2a}`);
});
