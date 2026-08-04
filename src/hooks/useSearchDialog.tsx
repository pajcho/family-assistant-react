import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { GlobalSearchDialog } from "@/components/search/GlobalSearchDialog";

/**
 * App-wide search, hosted once in the authenticated layout.
 *
 * Redizajn 2.0 moved the top chrome into the screens themselves (each screen
 * owns its header), so the magnifying glass now lives on Danas, Kalendar,
 * Novac... instead of a single global bar. They all open the same dialog
 * through this context, and ⌘/Ctrl+K keeps working from anywhere.
 */

const SearchDialogContext = createContext<{ openSearch: () => void } | null>(null);

export function SearchDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const openSearch = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ openSearch }), [openSearch]);

  return (
    <SearchDialogContext.Provider value={value}>
      {children}
      <GlobalSearchDialog open={open} onOpenChange={setOpen} />
    </SearchDialogContext.Provider>
  );
}

export function useSearchDialog(): { openSearch: () => void } {
  const ctx = useContext(SearchDialogContext);
  if (!ctx) throw new Error("useSearchDialog must be used within a <SearchDialogProvider>");
  return ctx;
}
