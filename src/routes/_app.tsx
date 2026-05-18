import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router";
import { AppNav } from "@/components/layout/AppNav";
import { IosInstallHint } from "@/components/common/IosInstallHint";
import { useAuth } from "@/hooks/useAuth";

/**
 * Protected layout route. All authenticated pages (dashboard, events,
 * payments, birthdays, expenses) sit under `_app` so they share <AppNav/>
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
  // SW update toast lives in __root.tsx (covers login too). The iOS install
  // banner only renders for authed users so we don't nag first-time visitors.
  return (
    <AuthGate>
      <div className="min-h-screen w-full overflow-x-hidden bg-gray-50 dark:bg-gray-900">
        <AppNav />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
        <IosInstallHint />
      </div>
    </AuthGate>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
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
