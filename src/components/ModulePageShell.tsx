"use client";

import { useNav } from "./NavContext";

/**
 * Two-mode layout for module pages:
 * - nav closed → article centered inside the viewport (max-w 720px)
 * - nav open  → sidebar on the left + article in the remaining column
 *
 * On mobile (<lg) the sidebar stacks above the article when nav is open.
 */
export function ModulePageShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const { open } = useNav();
  if (!open) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-6 py-10">{children}</main>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10 lg:flex-row lg:gap-10">
      {sidebar}
      <main className="min-w-0 flex-1 lg:max-w-[720px]">{children}</main>
    </div>
  );
}
