"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type NavCtx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const Ctx = createContext<NavCtx | null>(null);

const STORAGE_KEY = "iliad.navOpen";

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Restore state once on client.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setOpen(true);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {}
  }, [open]);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return <Ctx.Provider value={{ open, setOpen, toggle }}>{children}</Ctx.Provider>;
}

export function useNav(): NavCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNav must be used inside <NavProvider>");
  return v;
}
