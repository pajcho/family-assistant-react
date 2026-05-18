import { Outlet, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "sonner";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";

/**
 * Provider order: ThemeProvider outside (affects <html> dark class, no deps),
 * then QueryClientProvider (auth fetches don't go through Query yet, but
 * useProfile does and we want it under the same QueryClient), then
 * AuthProvider (no deps on Query in its public surface).
 */
export const Route = createRootRoute({
  component: () => (
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
  ),
});
