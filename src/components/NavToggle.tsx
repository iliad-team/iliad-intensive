/**
 * Sidebar toggle — a server-rendered button; public/site.js owns the click.
 *
 * No React on the client: worksheet pages ship without the framework (see
 * scripts/strip-hydration.mjs), so state lives as a `nav-open` class on <html>
 * (persisted in localStorage, restored pre-paint by the inline script in
 * layout.tsx) and both icons are in the markup, CSS showing one at a time.
 *
 * The button itself is display:none unless the page has a sidebar to toggle
 * (globals.css keys on `body:has(#module-sidebar)`), replacing the old
 * usePathname() check — same effect on the homepage, and it also hides the
 * button on /admin/status, where it never had anything to toggle.
 */
export function NavToggle() {
  return (
    <button
      type="button"
      id="nav-toggle"
      aria-label="Toggle modules menu"
      aria-expanded={false}
      className="shrink-0 rounded p-1.5 text-zinc-700 hover:bg-zinc-100"
    >
      <svg
        className="icon-open"
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      >
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </svg>
      <svg
        className="icon-close"
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      >
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    </button>
  );
}
