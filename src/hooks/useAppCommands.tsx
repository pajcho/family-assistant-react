import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import { GlobalAddSheet } from "@/components/common/GlobalAddSheet";
import { ShortcutsDialog } from "@/components/common/ShortcutsDialog";
import {
  CHORD_TIMEOUT_MS,
  SECTION_BY_SHORTCUT,
  isModalOpen,
  isTypingTarget,
} from "@/lib/shortcuts";

/**
 * The app-wide commands, hosted once in the authenticated layout: "Dodaj" and
 * the shortcuts list, plus the keyboard that fires them.
 *
 * The add sheet lives HERE rather than in each nav surface. The rail and the
 * bottom bar each used to own an instance, and since the rail is only hidden
 * (not unmounted) below `lg`, two were mounted at once; the keyboard would have
 * made a third, and `C` could then open a different sheet than the button. One
 * instance, three ways to reach it.
 */

type AppCommands = {
  /** Opens the global "Dodaj" sheet - the "+" button and `C` share it. */
  openAdd: () => void;
  openShortcuts: () => void;
};

const AppCommandsContext = createContext<AppCommands | null>(null);

export function AppCommandsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const openAdd = useCallback(() => setAddOpen(true), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);

  useEffect(() => {
    // `G` waits for its second key; anything else (or the timeout) cancels it,
    // so a stray G never leaves the app one keystroke from jumping screens.
    let armed = false;
    let timer: number | null = null;
    const disarm = () => {
      armed = false;
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Modifiers belong to the browser and the OS; ⌘K is handled on its own in
      // useSearchDialog, and everything here is deliberately modifier-free so
      // Mac and Windows read the same.
      if (event.metaKey || event.ctrlKey || event.altKey) {
        disarm();
        return;
      }
      if (isTypingTarget(event.target) || isModalOpen()) {
        disarm();
        return;
      }

      const key = event.key.toLowerCase();

      if (armed) {
        const section = SECTION_BY_SHORTCUT[key];
        disarm();
        if (!section) return;
        event.preventDefault();
        // `to` and `search` come from the shared nav list, so they are plain
        // strings here rather than the router's literal union.
        void navigate({ to: section.to, search: section.search } as never);
        return;
      }

      if (key === "g") {
        armed = true;
        timer = window.setTimeout(disarm, CHORD_TIMEOUT_MS);
        return;
      }
      if (key === "c") {
        event.preventDefault();
        openAdd();
        return;
      }
      // Matched on the produced CHARACTER, not on Shift+/, so it works on any
      // layout that can type a question mark.
      if (event.key === "?") {
        event.preventDefault();
        openShortcuts();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      disarm();
    };
  }, [navigate, openAdd, openShortcuts]);

  const value = useMemo<AppCommands>(() => ({ openAdd, openShortcuts }), [openAdd, openShortcuts]);

  return (
    <AppCommandsContext.Provider value={value}>
      {children}
      <GlobalAddSheet open={addOpen} onOpenChange={setAddOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </AppCommandsContext.Provider>
  );
}

export function useAppCommands(): AppCommands {
  const ctx = useContext(AppCommandsContext);
  if (!ctx) throw new Error("useAppCommands must be used within an <AppCommandsProvider>");
  return ctx;
}
