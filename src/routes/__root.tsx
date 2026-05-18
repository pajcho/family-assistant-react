import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "sonner";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { usePwaUpdate } from "@/hooks/usePwaUpdate";
import { Button } from "@/components/ui/button";

/**
 * Provider order: ThemeProvider outside (affects <html> dark class, no deps),
 * then QueryClientProvider (auth fetches don't go through Query yet, but
 * useProfile does and we want it under the same QueryClient), then
 * AuthProvider (no deps on Query in its public surface).
 */
export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  // SW registers at the root so the login page is also installable + cached.
  // The hook surfaces a sonner toast when a deploy ships a new bundle.
  usePwaUpdate();
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Outlet />
          <Toaster richColors position="top-center" />
          {import.meta.env.DEV ? (
            <>
              <TanStackRouterDevtools position="bottom-right" />
              <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
            </>
          ) : null}
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
          Stranica nije pronađena
        </h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          Tražena stranica ne postoji ili je premeštena.
        </p>
        <div className="mt-6">
          <Button asChild>
            <Link to="/">Nazad na početnu</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
