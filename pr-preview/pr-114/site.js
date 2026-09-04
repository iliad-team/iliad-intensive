/**
 * The site's entire client-side behaviour. Worksheet pages ship no framework
 * (scripts/strip-hydration.mjs removes Next's bundles after the build), so the
 * three interactions React used to own live here instead:
 *
 *   1. the sidebar toggle — a `nav-open` class on <html>, persisted in
 *      localStorage and restored pre-paint by the inline script in layout.tsx
 *   2. closing the sidebar when a link in it is followed on mobile
 *   3. the downloads "with solutions" checkbox — swaps each link between the
 *      hrefs carried in its data-sol / data-nosol attributes
 *
 * Everything is feature-detected off ids, so the file is safe (and inert) on
 * pages without a sidebar or downloads row, /admin/status included. If JS is
 * disabled entirely the page still reads fine: the sidebar stays in its
 * pre-paint state and the downloads default to the with-solutions files.
 */
(function () {
  "use strict";
  var KEY = "iliad.navOpen";
  var root = document.documentElement;

  function store(open) {
    try { localStorage.setItem(KEY, open ? "1" : "0"); } catch (e) {}
  }

  var toggle = document.getElementById("nav-toggle");
  if (toggle) {
    // The markup ships aria-expanded="false"; sync it with the restored state.
    toggle.setAttribute("aria-expanded", String(root.classList.contains("nav-open")));
    toggle.addEventListener("click", function () {
      var open = root.classList.toggle("nav-open");
      toggle.setAttribute("aria-expanded", String(open));
      store(open);
    });
  }

  // On mobile the open sidebar sits above the article, so following a link
  // should also put it away — on desktop it stays, as a reading aid.
  var sidebar = document.getElementById("module-sidebar");
  if (sidebar) {
    sidebar.addEventListener("click", function (e) {
      var a = e.target && e.target.closest && e.target.closest("a");
      if (!a || !window.matchMedia("(max-width: 1023px)").matches) return;
      root.classList.remove("nav-open");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
      store(false);
    });
  }

  var solutions = document.getElementById("solutions-toggle");
  if (solutions) {
    solutions.addEventListener("change", function () {
      var links = document.querySelectorAll("a[data-sol]");
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        a.setAttribute("href", solutions.checked ? a.dataset.sol : a.dataset.nosol);
      }
    });
  }
})();
