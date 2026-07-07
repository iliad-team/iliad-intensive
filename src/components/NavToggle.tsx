"use client";

import { usePathname } from "next/navigation";
import { useNav } from "./NavContext";

export function NavToggle() {
  const pathname = usePathname();
  const { open, toggle } = useNav();
  // The home page already lists every module — no toggle needed there.
  if (pathname === "/") return null;
  return (
    <button
      type="button"
      aria-label={open ? "Close modules menu" : "Open modules menu"}
      aria-expanded={open}
      onClick={toggle}
      className="shrink-0 rounded p-1.5 text-zinc-700 hover:bg-zinc-100"
    >
      <svg
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      >
        {open ? (
          <>
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </>
        ) : (
          <>
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </>
        )}
      </svg>
    </button>
  );
}
