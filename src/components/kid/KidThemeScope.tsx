import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { KidTheme } from "@/types/kid";

/**
 * A theme the pre-session screens can ask for.
 *
 * Only ONE place may write `data-kid-theme` (the kid layout), otherwise a
 * child component's unmount cleanup would tear the attribute off while the
 * layout still wants it. So the login screen does not paint the theme itself -
 * it announces which child is selected, and the layout paints it. That is what
 * makes the whole screen change colour the instant a child taps their name,
 * before any network call.
 */
interface KidThemeScopeValue {
  previewTheme: KidTheme | null;
  setPreviewTheme: (theme: KidTheme | null) => void;
}

const KidThemeScopeContext = createContext<KidThemeScopeValue>({
  previewTheme: null,
  setPreviewTheme: () => {},
});

export function KidThemeScopeProvider({ children }: { children: ReactNode }) {
  const [previewTheme, setPreviewTheme] = useState<KidTheme | null>(null);
  const value = useMemo(() => ({ previewTheme, setPreviewTheme }), [previewTheme]);
  return <KidThemeScopeContext.Provider value={value}>{children}</KidThemeScopeContext.Provider>;
}

export function useKidThemeScope(): KidThemeScopeValue {
  return useContext(KidThemeScopeContext);
}
