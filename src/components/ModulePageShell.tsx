/**
 * Two-mode layout for module pages:
 * - nav closed → article centered inside the viewport (max-w 720px)
 * - nav open  → sidebar on the left + article in the remaining column
 *
 * On mobile (<lg) the sidebar stacks above the article when nav is open.
 *
 * Server-rendered with BOTH states in the markup: the mode is the `nav-open`
 * class on <html> (set pre-paint from localStorage, toggled by site.js), and
 * the #page-shell rules in globals.css do what the conditional JSX used to.
 * That is what lets the page work with no React on the client — a page that
 * only renders one state needs a framework to build the other.
 */
export function ModulePageShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div id="page-shell" className="mx-auto w-full px-6 py-10">
      {sidebar}
      <main className="min-w-0 flex-1 lg:max-w-[720px]">{children}</main>
    </div>
  );
}
