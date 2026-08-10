import { useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { MobileBottomNav } from "@/components/layout/AppNav";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { PullToRefresh } from "@/components/common/PullToRefresh";
import { useAccentSync } from "@/hooks/useAccent";
import { AppCommandsProvider } from "@/hooks/useAppCommands";
import { useAuth } from "@/hooks/useAuth";
import { useFamilyChannel } from "@/hooks/useFamilyChannel";
import { SearchDialogProvider } from "@/hooks/useSearchDialog";
import { useVisibilityRefetch } from "@/hooks/useVisibilityRefetch";
import { sectionForPathname } from "@/components/layout/navSections";
import { recordNavRecent } from "@/lib/navRecents";
import { readKidClaims } from "@/types/kid";

/**
 * Protected layout route. All authenticated pages sit under `_app` so they
 * share the app frame: the desktop nav rail, the screen area, and the mobile
 * bottom bar.
 *
 * Redizajn 2.0 - the frame is FIXED at 100dvh and never scrolls. Each screen
 * scrolls inside its own container (see <AppScreen>), which is what lets the
 * header and the bottom bar be plain, motionless flex siblings. That retires
 * the window-scroll + `position: sticky` combination this app kept fighting on
 * iOS. The bottom bar is a sibling too, so nothing needs to reserve space for
 * a `position: fixed` element.
 *
 * Auth gating happens at render time via `<AuthGate>`. We can't use
 * `beforeLoad` cleanly because the Supabase session fetch is async and the
 * router has no context-bound auth state - render-gating keeps the logic
 * co-located with the React tree that depends on it.
 */
export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  // Standalone-PWA refresh reliability: refetch active queries when the app
  // resumes from a suspend (realtime channels rejoin on their own, but events
  // fired while suspended are lost), plus a pull-to-refresh gesture below.
  useVisibilityRefetch();

  // The app's only realtime subscription: one broadcast channel per family,
  // dispatching to the query keys the data hooks read. Mounted here so it lives
  // exactly once for the whole authenticated tree.
  useFamilyChannel();

  // Paint the user's chosen accent (the app colour) onto <html>.
  useAccentSync();

  // Feed the "Nedavno" row in the Meni sheet: every visit to one of the
  // sections is remembered per-device, whatever surface triggered it.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    const key = sectionForPathname(pathname);
    if (key) recordNavRecent(key);
  }, [pathname]);

  // SW update toast lives in __root.tsx (covers login too). The iOS install
  // banner lives on the login route - once you're signed in you've already
  // committed to the app, so the prompt would just be visual noise.
  return (
    <AuthGate>
      <SearchDialogProvider>
        <AppCommandsProvider>
          <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground">
            {/* >= lg: the nav rail. Below that it renders nothing and the bottom
              bar takes over. */}
            <AppSidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              {/* The screen area. `min-h-0` is what makes the inner scroll
                container actually scroll instead of stretching the frame. */}
              <div className="relative min-h-0 flex-1">
                <Outlet />
              </div>
              <MobileBottomNav />
            </div>
            <PullToRefresh />
          </div>
        </AppCommandsProvider>
      </SearchDialogProvider>
    </AuthGate>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  // While Supabase getSession() is in flight, render nothing rather than
  // flashing the layout - keeps the perceived load tighter and avoids
  // redirecting an already-authed user during the initial fetch.
  if (loading) return null;

  if (!session) {
    return <Navigate to="/login" />;
  }

  // Kid mode: a kid signs in against the same Supabase project but has no
  // row in `profiles`, so every screen under `_app` would render empty for
  // them. Their whole app is the `/kid` shell (a sibling layout route, so none
  // of this frame is even mounted). Read straight off the JWT claims - no
  // round trip, so there is no flash of the grown-up layout first.
  if (readKidClaims(session.user.app_metadata)) {
    return <Navigate to="/kid" />;
  }

  return <>{children}</>;
}
