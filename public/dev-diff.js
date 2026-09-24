/**
 * dev-diff.js — /dev/diff: pick a worksheet page and two of its historical
 * versions, then hand them to diff.js.
 *
 * The versions come from iliad-team/iliad-intensive-snapshots (this script's
 * data-src): index.json lists every version of every page, and
 * <slug>/<tree>.html is one version rendered to a full page. Nothing is built
 * here; see src/app/dev/diff/page.tsx.
 *
 *   1. Read index.json and fill the pickers from the query string
 *      (?page=&from=&to=, trees may be abbreviated). Defaults: the newest
 *      version, compared with the one before it.
 *   2. Put the "to" version's article into #dd-article as `.prose`.
 *   3. Point #diff-toggle at the "from" version (data-diff-url, the column
 *      labels) and load diff.js, which does the rest exactly as on a preview.
 *
 * On a preview build the banner has its own #diff-controls row (same ids);
 * the layout's diff.js has already given up on this page, which has no
 * article at load, so that row is removed before diff.js runs again here.
 */
(function () {
  "use strict";

  var me = document.currentScript;
  var SRC = me.getAttribute("data-src");
  var DIFF_JS = me.getAttribute("data-diff-js");
  var REPO = "https://github.com/iliad-team/iliad-intensive";

  var form = document.getElementById("dd-form");
  var selPage = document.getElementById("dd-page");
  var selFrom = document.getElementById("dd-from");
  var selTo = document.getElementById("dd-to");
  var info = document.getElementById("dd-info");
  var status = document.getElementById("dd-status");
  var article = document.getElementById("dd-article");
  // This page's own controls: a preview banner above has a row with the same ids.
  var controls = document.getElementById("dd-controls");
  var toggle = controls && controls.querySelector("#diff-toggle");
  if (!form || !article || !toggle) return;

  var query = new URLSearchParams(location.search);

  function say(msg) { status.textContent = msg || ""; status.hidden = !msg; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function getText(url) {
    return fetch(url, { credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
      return r.text();
    });
  }
  var day = function (v) { return v.commits[0].date.slice(0, 10); };
  var short = function (v) { return v.commits[0].sha.slice(0, 7); };
  function label(v) {
    var s = v.commits[0].subject;
    return day(v) + " · " + short(v) + " · " + (s.length > 70 ? s.slice(0, 69) + "…" : s);
  }
  function option(value, text) {
    var o = el("option", null, text);
    o.value = value;
    return o;
  }

  // The commits that produced a version: several when a branch and main both
  // reached the same tree, or a PR landed it again as a merge.
  function describe(side, cls, v) {
    var box = el("div");
    box.appendChild(el("div", "font-semibold uppercase tracking-wide " + cls, side));
    var ul = el("ul", "mt-1 space-y-0.5");
    v.commits.forEach(function (c) {
      var li = el("li");
      var a = el("a", "font-mono underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900", c.sha.slice(0, 7));
      a.href = REPO + "/commit/" + c.sha;
      li.appendChild(a);
      li.appendChild(document.createTextNode(" " + c.date.slice(0, 10) + " " + c.author + " — " + c.subject));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    return box;
  }

  getText(SRC + "index.json").then(JSON.parse).then(function (idx) {
    var okVersions = function (slug) {
      return (idx.pages[slug].versions || []).filter(function (v) { return v.status === "ok"; });
    };
    var slugs = Object.keys(idx.pages).filter(function (s) { return okVersions(s).length; }).sort();
    if (!slugs.length) throw new Error("the snapshot index lists no pages");

    var slug = slugs.indexOf(query.get("page")) >= 0 ? query.get("page") : slugs[0];
    slugs.forEach(function (s) {
      var n = okVersions(s).length;
      selPage.appendChild(option(s, s + " (" + n + " version" + (n === 1 ? "" : "s") + ")"));
    });
    selPage.value = slug;

    var vs = okVersions(slug);          // newest first
    var find = function (prefix) {
      if (!prefix) return null;
      return vs.filter(function (v) { return v.tree.indexOf(prefix) === 0; })[0] || null;
    };
    var to = find(query.get("to")) || vs[0];
    var from = find(query.get("from")) || vs[vs.indexOf(to) + 1] || to;
    vs.forEach(function (v) {
      selFrom.appendChild(option(v.tree.slice(0, 10), label(v)));
      selTo.appendChild(option(v.tree.slice(0, 10), label(v)));
    });
    selFrom.value = from.tree.slice(0, 10);
    selTo.value = to.tree.slice(0, 10);
    [selPage, selFrom, selTo].forEach(function (s) { s.disabled = false; });

    // A new page starts from its own defaults, not the old page's trees.
    selPage.addEventListener("change", function () {
      location.search = "?page=" + encodeURIComponent(selPage.value);
    });
    selFrom.addEventListener("change", function () { form.submit(); });
    selTo.addEventListener("change", function () { form.submit(); });

    info.appendChild(describe("from", "text-red-700", from));
    info.appendChild(describe("to", "text-green-700", to));
    var failed = (idx.pages[slug].versions || []).length - vs.length;

    say("loading " + slug + " at " + short(to) + "…");
    return getText(SRC + slug + "/" + to.tree + ".html").then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var prose = doc.querySelector("main article .prose");
      if (!prose) throw new Error("the snapshot has no article");
      Array.prototype.forEach.call(prose.querySelectorAll("script"), function (s) { s.remove(); });
      var h1 = doc.querySelector("main article header h1");
      if (h1) document.title = h1.textContent + " — history — Iliad";
      article.appendChild(document.importNode(prose, true));

      var note = failed ? failed + " version" + (failed === 1 ? "" : "s") + " of this page failed to render and are not listed." : "";
      if (from === to) {
        say((vs.length === 1 ? "This page has only one version." : "Pick two different versions to see a diff.") + (note ? " " + note : ""));
        controls.hidden = true;
        return;
      }
      say(note);
      toggle.setAttribute("data-diff-url", SRC + slug + "/" + from.tree + ".html");
      toggle.setAttribute("data-label-base", "from · " + day(from) + " · " + short(from));
      toggle.setAttribute("data-label-pr", "to · " + day(to) + " · " + short(to));
      Array.prototype.forEach.call(document.querySelectorAll("#diff-controls"), function (row) {
        if (!controls.contains(row)) row.remove();
      });
      var s = document.createElement("script");
      s.src = DIFF_JS;
      document.body.appendChild(s);
    });
  }).catch(function (err) {
    say("Could not load the snapshots: " + err.message);
  });
})();
