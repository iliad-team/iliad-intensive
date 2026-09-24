/**
 * diff.js — the PR-preview "diff" view: this page side by side with the same
 * page on the live site, differences highlighted like a git diff.
 *
 * Loaded by preview builds (layout.tsx adds the script when
 * NEXT_PUBLIC_PREVIEW_PR is set), and by /dev/diff (public/dev-diff.js, which
 * compares two snapshots of a page). Inert unless the page has a worksheet
 * article and a #diff-toggle checkbox (components/DiffControls.tsx). Vanilla
 * JS, like site.js: worksheet pages ship no framework (strip-hydration.mjs).
 *
 * #diff-toggle's data-* attributes say where the base comes from:
 *   data-diff-base, data-base-path   preview: this page's path on the base site
 *   data-diff-url                    a fixed URL instead (/dev/diff)
 *   data-label-base, data-label-pr   the two column headings
 *   data-key                         localStorage key for on/off (default iliad.diff)
 *   data-autostart                   start on, unless the reader turned it off
 *
 * How it works
 *   1. Fetch the SAME path from the base site — production is served from the
 *      same origin as /pr-preview/pr-N/, so this is a plain same-origin fetch
 *      (locally, data-diff-base points it at https://iliad-intensive.org,
 *      which sends `access-control-allow-origin: *`). A 404 means the page is
 *      new on this PR: the checkbox disables itself and says so.
 *   2. Split both articles into LEAF BLOCKS — paragraphs, headings, list items,
 *      display equations, tables — by descending through containers (section,
 *      div, details, ul...) until an element has no block children. A display
 *      equation is keyed by its TeX source (KaTeX's aria-label), prose by its
 *      normalised text.
 *   3. Sequence-diff the two block lists (common prefix/suffix stripped, then
 *      LCS). Unmatched blocks are removed (red, left) or added (green, right);
 *      a removed+added pair that share enough words is a MODIFIED pair, and
 *      gets a word-level diff inside (inline maths is one atomic token).
 *   4. Lay both articles out in two columns, then ALIGN them: for every matched
 *      pair, whichever side sits higher gets a spacer above it so the pair
 *      shares a row. Removed/added blocks therefore face a blank on the other
 *      side, exactly like GitHub's split view. Because the columns share the
 *      page's scroll, they stay in sync for free; "sync scroll" off gives each
 *      column its own scrollbar instead.
 *
 * Solutions (<details>) that contain a change are opened so the change shows.
 * Turning the view off swaps back a pristine copy of the article.
 *
 * Two more controls in the banner:
 *   - "allow stretched margins" (off): each column is the page's own reading
 *     width, so anything that overflows the real page overflows here too — the
 *     point of reviewing a diff of a maths-heavy page. On, the columns share
 *     the viewport instead. Toggling rebuilds the view, since the spacers that
 *     level the rows depend on the column width.
 *   - "next change": steps through the removed / added / modified blocks in
 *     position order, scrolling each into view with an amber ring, and turns
 *     the diff on first if it is off.
 *   - "show column edge" (off): a red line down the right edge of every
 *     article column and a dashed outline on each display equation wider than
 *     its column, with a count in the label. Independent of the diff: it works
 *     on the plain preview page too, and survives the diff opening or closing.
 *   - "hide unchanged" (on): the article's top-level blocks — paragraphs,
 *     headings, whole exercise/theorem boxes, lists — that match on both sides
 *     fold away, one block of context kept beside each change, one strip per
 *     section naming its heading and saying how many blocks it holds. Clicking
 *     a strip unfolds that run; clicking it again folds it back. Folds go in
 *     both columns and are levelled like any matched pair.
 */
(function () {
  "use strict";

  var toggle = document.getElementById("diff-toggle");
  var syncBox = document.getElementById("diff-sync");
  var stretchBox = document.getElementById("diff-stretch");
  var hideBox = document.getElementById("diff-hide");
  var edgeBox = document.getElementById("diff-edge");
  var edgeCount = document.getElementById("diff-edge-count");
  var nextBtn = document.getElementById("diff-next");
  var status = document.getElementById("diff-status");
  var controls = document.getElementById("diff-controls");
  if (!toggle || !controls) return;

  var prose = document.querySelector("main article .prose");
  if (!prose) { controls.hidden = true; return; }

  var root = document.documentElement;
  var KEY = toggle.getAttribute("data-key") || "iliad.diff";
  var SYNC_KEY = "iliad.diffSync";
  var STRETCH_KEY = "iliad.diffStretch";
  var HIDE_KEY = "iliad.diffHide";
  var EDGE_KEY = "iliad.diffEdge";

  // Where the base version of THIS page lives: the same path, minus the
  // preview's base path, on the base origin ("" = this origin's root).
  var basePath = toggle.getAttribute("data-base-path") || "";
  var baseOrigin = toggle.getAttribute("data-diff-base") || "";
  var pagePath = location.pathname;
  if (basePath && pagePath.indexOf(basePath) === 0) pagePath = pagePath.slice(basePath.length) || "/";
  var baseUrl = toggle.getAttribute("data-diff-url") || baseOrigin + pagePath;
  var LABEL_BASE = toggle.getAttribute("data-label-base") || "main (live site)";
  var LABEL_PR = toggle.getAttribute("data-label-pr") || "this pull request";

  var pristine = prose.cloneNode(true);
  var view = null;
  var basePromise = null;
  // The stops "next change" walks: one entry per removed block ([base el]),
  // added block ([pr el]) or modified pair ([base el, pr el]), in emission
  // order; sorted by position at click time, once the rows have settled.
  var stops = [];
  var cur = -1;
  var summary = "";

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function say(msg) { if (status) status.textContent = msg || ""; }

  // ------------------------------------------------------------ fetch base
  function fetchBase() {
    if (!basePromise) {
      basePromise = fetch(baseUrl, { credentials: "omit" })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, "text/html");
          var p = doc.querySelector("main article .prose");
          if (!p) throw new Error("base page has no article");
          return p;
        });
      basePromise.catch(function () { basePromise = null; });
    }
    return basePromise;
  }

  // ------------------------------------------------------------ leaf blocks
  var BLOCK = /^(P|DIV|SECTION|UL|OL|LI|DETAILS|SUMMARY|H[1-6]|BLOCKQUOTE|TABLE|PRE|FIGURE|HEADER|FOOTER|ASIDE|NAV|HR)$/;

  function isAtomic(el) {
    return el.matches(".katex-display, table, pre, figure, svg, img, hr");
  }
  function hasBlockChildren(el) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (BLOCK.test(c.tagName) || c.classList.contains("katex-display")) return true;
    }
    return false;
  }
  // A container may hold inline runs beside its block children (an <li> whose
  // text is followed by a nested <ul>). Wrap each such run so it is a leaf too.
  function wrapInlineRuns(el) {
    var run = [];
    var flush = function () {
      var meaningful = run.some(function (n) {
        return n.nodeType === 1 || /\S/.test(n.nodeValue);
      });
      if (meaningful) {
        var span = document.createElement("span");
        span.className = "diff-inline-run";
        run[0].parentNode.insertBefore(span, run[0]);
        run.forEach(function (n) { span.appendChild(n); });
      }
      run = [];
    };
    var kids = Array.prototype.slice.call(el.childNodes);
    kids.forEach(function (n) {
      var block = n.nodeType === 1 && (BLOCK.test(n.tagName) || n.classList.contains("katex-display") || n.classList.contains("diff-spacer"));
      if (block) flush(); else run.push(n);
    });
    flush();
  }
  function leaves(el, out) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.classList.contains("diff-spacer")) continue;
      if (isAtomic(c) || !hasBlockChildren(c)) out.push(c);
      else { wrapInlineRuns(c); leaves(c, out); }
    }
    return out;
  }
  function blockKey(el) {
    if (el.classList.contains("katex-display")) return "M" + el.getAttribute("aria-label");
    return el.tagName + ":" + (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  // ------------------------------------------------------------ sequence diff
  // ops: ["=", i, j] | ["-", i, -1] | ["+", -1, j], in order.
  function diffSeq(a, b) {
    var n = a.length, m = b.length, pre = 0, suf = 0, i, j;
    while (pre < n && pre < m && a[pre] === b[pre]) pre++;
    while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
    var ops = [];
    for (i = 0; i < pre; i++) ops.push(["=", i, i]);
    var N = n - pre - suf, M = m - pre - suf;
    if (N && M && N * M <= 6e6) {
      var W = M + 1, L = new Uint32Array((N + 1) * W);
      for (i = N - 1; i >= 0; i--) {
        for (j = M - 1; j >= 0; j--) {
          L[i * W + j] = a[pre + i] === b[pre + j]
            ? L[(i + 1) * W + j + 1] + 1
            : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
        }
      }
      i = 0; j = 0;
      while (i < N && j < M) {
        if (a[pre + i] === b[pre + j]) { ops.push(["=", pre + i, pre + j]); i++; j++; }
        else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) { ops.push(["-", pre + i, -1]); i++; }
        else { ops.push(["+", -1, pre + j]); j++; }
      }
      while (i < N) ops.push(["-", pre + i++, -1]);
      while (j < M) ops.push(["+", -1, pre + j++]);
    } else {
      for (i = 0; i < N; i++) ops.push(["-", pre + i, -1]);
      for (j = 0; j < M; j++) ops.push(["+", -1, pre + j]);
    }
    for (i = 0; i < suf; i++) ops.push(["=", n - suf + i, m - suf + i]);
    return ops;
  }

  // Within each run of removed/added blocks, pair up the ones that are the
  // same kind of element and share enough words: those are edits, not a
  // deletion plus an unrelated insertion. Returns ops with "~" pairs.
  function words(el) {
    var set = {};
    (el.textContent || "").toLowerCase().split(/[^a-z0-9\\]+/).forEach(function (w) { if (w) set[w] = 1; });
    return set;
  }
  function similarity(a, b) {
    var wa = words(a), wb = words(b), inter = 0, union = 0, k;
    for (k in wa) { union++; if (wb[k]) inter++; }
    for (k in wb) { if (!wa[k]) union++; }
    return union ? inter / union : 0;
  }
  function pairEdits(ops, A, B) {
    var out = [], run = [];
    var flush = function () {
      if (!run.length) return;
      var dels = run.filter(function (o) { return o[0] === "-"; });
      var ins = run.filter(function (o) { return o[0] === "+"; });
      var cands = [];
      dels.forEach(function (d) {
        ins.forEach(function (n) {
          var a = A[d[1]], b = B[n[2]];
          if (a.tagName !== b.tagName) return;
          var s = a.classList.contains("katex-display") ? 0.5 : similarity(a, b);
          if (s >= 0.3) cands.push([s, d, n]);
        });
      });
      cands.sort(function (x, y) { return y[0] - x[0]; });
      var usedD = new Set(), usedI = new Set(), pair = new Map();
      cands.forEach(function (c) {
        if (usedD.has(c[1]) || usedI.has(c[2])) return;
        usedD.add(c[1]); usedI.add(c[2]); pair.set(c[1], c[2]);
      });
      dels.forEach(function (d) {
        if (pair.has(d)) out.push(["~", d[1], pair.get(d)[2]]);
        else out.push(d);
      });
      ins.forEach(function (n) { if (!usedI.has(n)) out.push(n); });
      run = [];
    };
    ops.forEach(function (o) {
      if (o[0] === "=") { flush(); out.push(o); } else run.push(o);
    });
    flush();
    return out;
  }

  // ------------------------------------------------------------ word diff
  function tokens(el) {
    var out = [];
    (function walk(n) {
      if (n.nodeType === 3) {
        var re = /\s+|\S+/g, m, t = n.nodeValue;
        while ((m = re.exec(t))) {
          out.push({ node: n, start: m.index, end: m.index + m[0].length, key: /^\s+$/.test(m[0]) ? " " : m[0] });
        }
      } else if (n.nodeType === 1) {
        if (n.classList.contains("katex")) { out.push({ el: n, key: "M" + n.getAttribute("aria-label") }); return; }
        for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      }
    })(el);
    return out;
  }
  function applyMarks(toks, idxs, cls) {
    // Back to front: wrapping a range splits its text node, which would move
    // the offsets of every token after it in that node.
    for (var q = idxs.length - 1; q >= 0; q--) {
      var t = toks[idxs[q]];
      if (t.key === " ") continue;
      if (t.el) { t.el.classList.add(cls); continue; }
      var r = document.createRange();
      r.setStart(t.node, t.start); r.setEnd(t.node, t.end);
      var mark = document.createElement("mark");
      mark.className = cls;
      try { r.surroundContents(mark); } catch (e) {}
    }
  }
  function markWords(a, b) {
    var ta = tokens(a), tb = tokens(b);
    if (!ta.length || !tb.length || ta.length * tb.length > 4e6) return;
    var ops = diffSeq(ta.map(function (t) { return t.key; }), tb.map(function (t) { return t.key; }));
    var del = [], ins = [];
    ops.forEach(function (o) { if (o[0] === "-") del.push(o[1]); else if (o[0] === "+") ins.push(o[2]); });
    applyMarks(ta, del, "diff-del");
    applyMarks(tb, ins, "diff-ins");
  }

  // ------------------------------------------------------------ alignment
  function openDetails(el) {
    for (var d = el.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) d.open = true;
  }
  function mkSpacer() {
    var s = document.createElement("div");
    s.className = "diff-spacer";
    s.setAttribute("aria-hidden", "true");
    return s;
  }
  // Grow (or create) the spacer above `el`, hoisted out of any box `el` opens,
  // so the blank sits between boxes rather than inside one.
  function pad(el, colRoot, px) {
    var target = el;
    while (target.parentElement !== colRoot && !target.previousElementSibling) target = target.parentElement;
    var s = target.previousElementSibling;
    if (!(s && s.classList.contains("diff-spacer"))) {
      s = mkSpacer();
      target.parentNode.insertBefore(s, target);
      openDetails(s);
    }
    var h = Math.max(0, (parseFloat(s.style.height) || 0) + px);
    s.style.height = h + "px";
    // Hatch the blanks that stand in for a missing block; the few px that
    // only true-up margins around a spacer stay invisible.
    s.classList.toggle("diff-gap", h >= 20);
  }
  function visible(r) { return r.width > 0 || r.height > 0; }
  // One pass: measure every matched pair (no DOM writes), then pad whichever
  // side of each pair sits higher. Column shifts accumulate downwards, so the
  // predicted position of a pair is its measured top plus the padding already
  // added above it in its column.
  function settle(pairs, rootL, rootR) {
    var rects = pairs.map(function (p) { return [p[0].getBoundingClientRect(), p[1].getBoundingClientRect()]; });
    var accL = 0, accR = 0, moved = 0;
    pairs.forEach(function (p, k) {
      var ra = rects[k][0], rb = rects[k][1];
      if (!visible(ra) || !visible(rb)) return;
      var d = (ra.top + accL) - (rb.top + accR);
      if (Math.abs(d) < 0.5) return;
      if (d > 0) { pad(p[1], rootR, d); accR += d; } else { pad(p[0], rootL, -d); accL += -d; }
      moved++;
    });
    return moved;
  }

  // ------------------------------------------------------------ hide unchanged
  var CONTEXT = 1;                     // unchanged top-level blocks kept beside a change
  function isHeading(el) { return /^H[1-6]$/.test(el.tagName); }
  function topOf(el, root) {
    while (el && el.parentElement !== root) el = el.parentElement;
    return el;
  }
  // Fold at the level of the article's TOP-LEVEL blocks — a paragraph, a
  // heading, a whole exercise or theorem box, a list — not the leaves inside
  // them, so an unchanged section vanishes with its chrome instead of leaving
  // empty boxes and lone headings behind. A PR top corresponds to the base top
  // that holds the other half of any matched leaf pair inside it; a top is
  // foldable when nothing in it changed. Runs of foldable tops keep CONTEXT
  // blocks beside each change and fold the rest, one strip per section (a
  // heading starts a new strip and names it). The article's two ends have no
  // change beyond them, so they keep no context. Returns the number of tops
  // hidden; the strips are pushed onto `pairs` so settle() keeps them level.
  function foldUnchanged(ops, A, B, pairs, realign, rootA, rootB) {
    var CHANGED = ".diff-removed, .diff-added, .diff-modified";
    var changedIn = function (top) { return top.matches(CHANGED) || !!top.querySelector(CHANGED); };
    var partner = new Map();           // PR top -> base top
    ops.forEach(function (o) {
      if (o[0] !== "=") return;
      var ta = topOf(A[o[1]], rootA), tb = topOf(B[o[2]], rootB);
      if (ta && tb && !partner.has(tb)) partner.set(tb, ta);
    });
    var tops = function (root) {
      return Array.prototype.filter.call(root.children, function (t) { return !t.classList.contains("diff-spacer"); });
    };
    var idxA = new Map();
    tops(rootA).forEach(function (t, i) { idxA.set(t, i); });
    var hidden = 0, run = [], lastA = -1, sawChange = false;

    var foldSegment = function (seg) {                 // seg: [[prTop, baseTop], …]
      var head = isHeading(seg[0][0]) ? seg[0][0].textContent.replace(/\s+/g, " ").trim() : null;
      var n = seg.length - (head ? 1 : 0);             // blocks besides the heading
      if (head ? n < 1 : n < 2) return;                // nothing worth a strip
      var els = [];
      seg.forEach(function (p) { els.push(p[0], p[1]); });
      var folded = true;
      var mk = function (before) {
        var f = document.createElement("div");
        f.className = "diff-fold";
        f.setAttribute("role", "button");
        before.parentNode.insertBefore(f, before);
        return f;
      };
      var fb = mk(seg[0][0]), fa = mk(seg[0][1]);
      // The strip stays either way and toggles the run: the same click that
      // shows the blocks hides them again. Both columns' strips are a matched
      // pair, so their row is re-levelled with the rest after each toggle.
      var apply = function () {
        els.forEach(function (el) { el.classList.toggle("diff-hidden", folded); });
        var text = "⋯ " + (head ? "§ " + head + " — " : "") +
          n + " unchanged block" + (n === 1 ? "" : "s") +
          (folded ? " — click to show" : " shown — click to hide");
        fa.textContent = text; fb.textContent = text;
        fa.classList.toggle("diff-fold-open", !folded);
        fb.classList.toggle("diff-fold-open", !folded);
      };
      var toggleRun = function () { folded = !folded; apply(); realign(); };
      apply();
      fa.addEventListener("click", toggleRun);
      fb.addEventListener("click", toggleRun);
      pairs.push([fa, fb]);
      hidden += seg.length;
    };
    var flush = function (atEnd) {
      // Context after a change is worth keeping when it is prose; a heading
      // there only names the next section, which its strip does already, so
      // it folds with its section. Context BEFORE a change stays whatever it
      // is — a heading there says which section the change sits in.
      var lead = !sawChange || (run.length && isHeading(run[0][0])) ? 0 : CONTEXT;
      var inner = run.slice(lead, run.length - (atEnd ? 0 : CONTEXT));
      run = [];
      if (!inner.length) return;
      var seg = [];
      inner.forEach(function (p) {
        if (isHeading(p[0]) && seg.length) { foldSegment(seg); seg = []; }
        seg.push(p);
      });
      foldSegment(seg);
    };
    tops(rootB).forEach(function (tb) {
      var ta = partner.get(tb);
      // Foldable: unchanged on both sides, and its partner follows the previous
      // one in the base column, so the two columns fold the same stretch.
      if (ta && !changedIn(tb) && !changedIn(ta) && idxA.get(ta) > lastA) {
        run.push([tb, ta]);
        lastA = idxA.get(ta);
        return;
      }
      flush(false);
      sawChange = true;
      if (ta && idxA.has(ta)) lastA = Math.max(lastA, idxA.get(ta));
    });
    flush(true);
    return hidden;
  }

  // ------------------------------------------------------------ build / teardown
  function column(label, cls, content) {
    var col = document.createElement("div");
    col.className = "diff-col " + cls;
    var head = document.createElement("div");
    head.className = "diff-col-head";
    head.textContent = label;
    col.appendChild(head);
    col.appendChild(content);
    return col;
  }

  function build(baseProse) {
    var base = document.importNode(baseProse, true);
    // Its ids and #links must not collide with (or jump to) the PR column.
    Array.prototype.forEach.call(base.querySelectorAll("[id]"), function (e) { e.id = "base-" + e.id; });
    Array.prototype.forEach.call(base.querySelectorAll('a[href^="#"]'), function (a) {
      a.setAttribute("href", "#base-" + a.getAttribute("href").slice(1));
    });

    view = document.createElement("div");
    view.className = "diff-view";
    prose.parentNode.insertBefore(view, prose);
    view.appendChild(column(LABEL_BASE, "diff-col-base", base));
    view.appendChild(column(LABEL_PR, "diff-col-pr", prose));
    root.classList.add("diff-open");

    var A = leaves(base, []), B = leaves(prose, []);
    var ops = pairEdits(diffSeq(A.map(blockKey), B.map(blockKey)), A, B);
    var pairs = [], removed = 0, added = 0, modified = 0;
    stops = []; cur = -1;
    ops.forEach(function (o) {
      if (o[0] === "=") { pairs.push([A[o[1]], B[o[2]]]); return; }
      if (o[0] === "-") { A[o[1]].classList.add("diff-removed"); openDetails(A[o[1]]); removed++; stops.push([A[o[1]]]); return; }
      if (o[0] === "+") { B[o[2]].classList.add("diff-added"); openDetails(B[o[2]]); added++; stops.push([B[o[2]]]); return; }
      var a = A[o[1]], b = B[o[2]];
      a.classList.add("diff-modified"); b.classList.add("diff-modified");
      openDetails(a); openDetails(b);
      if (!a.classList.contains("katex-display")) markWords(a, b);
      pairs.push([a, b]);
      stops.push([a, b]);
      modified++;
    });
    var align = function (reset) {
      if (!view) return;
      // Spacers only ever grow, so after an unfold they are re-derived from a
      // clean slate rather than left over-padded around the fold that went.
      if (reset) Array.prototype.forEach.call(view.querySelectorAll(".diff-spacer"), function (s) { s.remove(); });
      // settle() accumulates shifts down the column, so the pairs must be in
      // column order — the folds were appended after the matched pairs.
      pairs.sort(function (x, y) { return x[0].getBoundingClientRect().top - y[0].getBoundingClientRect().top; });
      settle(pairs, base, prose);
      settle(pairs, base, prose); // margins that stopped collapsing around new spacers
      markOverflow(); // folds opened or closed change what is on view
    };
    var hidden = hideBox && hideBox.checked
      ? foldUnchanged(ops, A, B, pairs, function () { align(true); }, base, prose)
      : 0;
    summary = (removed + added + modified
      ? "−" + removed + " +" + added + " ~" + modified + " blocks"
      : "no differences") + (hidden ? " · " + hidden + " unchanged hidden" : "");
    say(summary);
    var alignGrow = function () { align(false); };
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(alignGrow);
    window.addEventListener("load", alignGrow);
    // Images and lazy layout can land later; one more pass a moment on.
    setTimeout(alignGrow, 1500);
  }

  function teardown() {
    if (!view) return;
    var fresh = pristine.cloneNode(true);
    view.parentNode.replaceChild(fresh, view);
    prose = fresh;
    view = null;
    stops = []; cur = -1; summary = "";
    root.classList.remove("diff-open");
    say("");
    markOverflow();
  }

  // ------------------------------------------------------------ column edge
  // "show column edge": globals.css draws the line (html.diff-edge); this marks
  // every display equation whose box is wider than its column — the overflow
  // scripts/check-overflow.mjs reports, which the .katex-display scroll box
  // otherwise hides — and counts them in the checkbox's label. Measured over
  // whatever is on view: the article alone, or both diff columns; a block
  // folded away by "hide unchanged" has no width and is not counted until
  // its strip is unfolded (align() re-marks).
  function markOverflow() {
    var on = edgeBox && edgeBox.checked;
    var count = 0;
    var scope = view || prose;
    Array.prototype.forEach.call(scope.querySelectorAll(".katex-display"), function (el) {
      var over = el.scrollWidth - el.clientWidth;
      var bad = on && over > 13; // check-overflow.mjs's SLACK (calibrated by eye)
      el.classList.toggle("diff-overflow", bad);
      if (bad) { el.title = "overflows the column by " + over + "px"; count++; }
      else if (el.title && el.title.indexOf("overflows the column") === 0) el.removeAttribute("title");
    });
    if (edgeCount) {
      edgeCount.textContent = !on ? ""
        : count ? " (" + count + " equation" + (count === 1 ? "" : "s") + " overflow" + (count === 1 ? "s" : "") + ")"
        : " (nothing in view overflows)";
    }
  }

  // ------------------------------------------------------------ next change
  // A stop's position within its column, valid in both scroll modes: with
  // sync scroll the columns share the page and their tops coincide; without,
  // each column scrolls alone and its scrollTop is added back in.
  function posOf(el) {
    var col = el.closest(".diff-col");
    var r = el.getBoundingClientRect(), c = col.getBoundingClientRect();
    return r.top - c.top + col.scrollTop;
  }
  function goTo(i, n, total) {
    if (cur !== -1) stops[cur].forEach(function (el) { el.classList.remove("diff-current"); });
    cur = i;
    stops[i].forEach(function (el) { el.classList.add("diff-current"); });
    // The PR side of a pair, or the block's only side.
    var target = stops[i][stops[i].length - 1];
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    say("change " + n + " of " + total + " · " + summary);
  }
  function nextChange() {
    if (!view) {
      toggle.checked = true;
      store(KEY, "1");
      enable().then(function () { if (view) nextChange(); });
      return;
    }
    if (!stops.length) { say(summary); return; }
    var order = stops.map(function (s, i) { return [posOf(s[0]), i]; })
      .sort(function (x, y) { return x[0] - y[0]; });
    var k = 0;
    if (cur !== -1) {
      for (var q = 0; q < order.length; q++) {
        if (order[q][1] === cur) { k = (q + 1) % order.length; break; }
      }
    }
    goTo(order[k][1], k + 1, order.length);
  }

  // ------------------------------------------------------------ controls
  // Resolves once the view is built (or the attempt has failed and said so),
  // so "next change" can wait for it.
  function enable() {
    say("loading " + (toggle.getAttribute("data-label-base") || "main") + "…");
    toggle.disabled = true;
    return fetchBase().then(function (baseProse) {
      toggle.disabled = false;
      if (!toggle.checked) return;
      build(baseProse);
    }).catch(function (err) {
      toggle.checked = false;
      toggle.disabled = true;
      store(KEY, "0");
      say(/HTTP 404/.test(err.message) ? "no diff: page is new on this PR" : "no diff: " + err.message);
    });
  }

  toggle.addEventListener("change", function () {
    store(KEY, toggle.checked ? "1" : "0");
    if (toggle.checked) enable(); else teardown();
  });

  if (syncBox) {
    var applySync = function () {
      root.classList.toggle("diff-unsync", !syncBox.checked);
      store(SYNC_KEY, syncBox.checked ? "1" : "0");
    };
    if (load(SYNC_KEY) === "0") syncBox.checked = false;
    applySync();
    syncBox.addEventListener("change", applySync);
  }

  if (stretchBox) {
    var applyStretch = function (rebuild) {
      root.classList.toggle("diff-stretch", stretchBox.checked);
      store(STRETCH_KEY, stretchBox.checked ? "1" : "0");
      // The spacers were measured at the old column width: rebuild the view
      // (the base article is already fetched) rather than re-settle on top of
      // stale padding.
      if (rebuild && view) {
        fetchBase().then(function (baseProse) { teardown(); build(baseProse); });
      }
    };
    if (load(STRETCH_KEY) === "1") stretchBox.checked = true;
    applyStretch(false);
    stretchBox.addEventListener("change", function () { applyStretch(true); });
  }

  if (hideBox) {
    var applyHide = function (rebuild) {
      store(HIDE_KEY, hideBox.checked ? "1" : "0");
      // Folding is decided while the view is built, so a change rebuilds it.
      if (rebuild && view) {
        fetchBase().then(function (baseProse) { teardown(); build(baseProse); });
      }
    };
    if (load(HIDE_KEY) === "0") hideBox.checked = false;
    applyHide(false);
    hideBox.addEventListener("change", function () { applyHide(true); });
  }

  if (edgeBox) {
    var applyEdge = function () {
      root.classList.toggle("diff-edge", edgeBox.checked);
      store(EDGE_KEY, edgeBox.checked ? "1" : "0");
      markOverflow();
    };
    if (load(EDGE_KEY) === "1") edgeBox.checked = true;
    applyEdge();
    edgeBox.addEventListener("change", applyEdge);
    // Widths settle with the web fonts, and change with the viewport.
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(markOverflow);
    var edgeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(edgeTimer);
      edgeTimer = setTimeout(markOverflow, 150);
    });
  }

  if (nextBtn) nextBtn.addEventListener("click", nextChange);

  var on = load(KEY);
  if (on === "1" || (on === null && toggle.hasAttribute("data-autostart"))) { toggle.checked = true; enable(); }
})();
