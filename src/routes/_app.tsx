import type { ReactNode } from "react";
import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router";
import { AppNav } from "@/components/layout/AppNav";
import { useAuth } from "@/hooks/useAuth";
import { useIsKeyboardOpen } from "@/hooks/useIsKeyboardOpen";
import { cn } from "@/lib/cn";

/**
 * Protected layout route. All authenticated pages (dashboard, events,
 * payments, birthdays, lists) sit under `_app` so they share <AppNav/>
 * and the centered <main> container.
 *
 * Auth gating happens at render time via `<AuthGate>`. We can't use
 * `beforeLoad` cleanly because the Supabase session fetch is async and the
 * router has no context-bound auth state — render-gating keeps the logic
 * co-located with the React tree that depends on it.
 */
export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  // When the on-screen keyboard opens we hide the bottom nav (see
  // MobileBottomNav) — at that moment the `pb-32` clearance we reserve
  // for the nav is just empty space that iOS leaves visible above the
  // keyboard after scrolling the focused input into view. Drop the
  // padding while the keyboard is up so the page collapses to the
  // input's natural bottom.
  const keyboardOpen = useIsKeyboardOpen();

  // SW update toast lives in __root.tsx (covers login too). The iOS install
  // banner lives on the login route — once you're signed in you've already
  // committed to the app, so the prompt would just be visual noise.
  return (
    <AuthGate>
      <div className="min-h-screen w-full bg-gray-50 dark:bg-gray-900">
        <AppNav />
        {/* `w-full` clamps the inner column to the viewport — without it,
            a child that's wider than its container can briefly bleed
            outside in iOS Safari (seen as a sliver of the previous page
            after navigation). Horizontal-bleed containment lives on <body>
            (`overflow-x-hidden`, which propagates to the viewport) — we do
            NOT repeat it here, because an intermediate `overflow` ancestor
            becomes a scroll container and breaks the `position: sticky` week
            strip on the Uskoro tab.

            Mobile: leave room at the bottom for the fixed
            <MobileBottomNav>. The bar is ~64px + the iPhone home-indicator
            safe-area inset (~34px on devices with a notch), so we reserve
            `pb-32` (128px). When the keyboard is open, the nav is hidden
            and the padding collapses to `pb-6` so iOS doesn't leave the
            reserved area as visible whitespace above the keyboard. The
            bottom-nav clearance flips at `md` (768px) to stay in step
            with AppNav's mobile cutoff. */}
        <main
          className={cn(
            "mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 md:pb-6 lg:px-8",
            keyboardOpen ? "pb-6" : "pb-32",
          )}
        >
          <Outlet />
        </main>
      </div>
    </AuthGate>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  // While Supabase getSession() is in flight, render nothing rather than
  // flashing the layout — keeps the perceived load tighter and avoids
  // redirecting an already-authed user during the initial fetch.
  if (loading) return null;

  if (!session) {
    return <Navigate to="/login" />;
  }

  return <>{children}</>;
}
