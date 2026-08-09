import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { KidTheme } from "@/types/kid";

/**
 * A theme the pre-session screens can ask for.
 *
 * Only ONE place may write `data-kid-theme` (the kid layout), otherwise a
 * child component's unmount cleanup would tear the attribute off while the
 * layout still wants it. So the login screen does not paint the theme itself -
 * it announces which child is selected, and the layout paints it.
 *
 * The sign-in screen no longer shows that theme (it wears the app's own violet
 * - see `.kid-auth-screen`), so what this buys is the frame AFTER a correct
 * PIN: the document is already in the child's colours when the app screen
 * mounts, without waiting on a network call. The parent's preview of a child's
 * app, which does show the theme, uses the same channel.
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
