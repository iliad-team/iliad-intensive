import Link from "next/link";
import { IliadMark } from "./IliadMark";
import { NavToggle } from "./NavToggle";

export function Navbar() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-zinc-200 bg-[var(--background)]/90 backdrop-blur supports-[backdrop-filter]:bg-[var(--background)]/80">
      <div className="mx-auto flex h-[var(--header-h)] max-w-6xl items-center gap-3 px-4 sm:px-6 font-sans text-sm">
        <NavToggle />
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-zinc-700 hover:text-black"
        >
          <IliadMark size={18} className="text-black" />
          <span className="hidden font-medium sm:inline">Iliad Intensive Curriculum</span>
          <span className="font-medium sm:hidden">Iliad</span>
        </Link>
        <button
          type="button"
          id="theme-toggle"
          aria-label="Dark mode"
          aria-pressed={false}
          title="Toggle light and dark mode"
          suppressHydrationWarning
          className="ml-auto shrink-0 rounded p-2 text-zinc-700 hover:bg-zinc-100"
        >
          <svg className="theme-moon" width={20} height={20} viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth={1.8}
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
          </svg>
          <svg className="theme-sun" width={20} height={20} viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth={1.8}
            strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
          </svg>
        </button>
      </div>
    </header>
  );
}
