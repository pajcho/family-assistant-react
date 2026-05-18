import { createFileRoute } from "@tanstack/react-router";
import { useProfile } from "@/hooks/useProfile";

/**
 * Stub dashboard. Phase 4 replaces this with the full dashboard (4 cards +
 * PullToRefresh wrapper). For Phase 1A we just need a page that proves the
 * protected layout works and that `useProfile` returns the family name.
 */
export const Route = createFileRoute("/_app/")({
  component: DashboardStub,
});

function DashboardStub() {
  const { familyName, isLoading } = useProfile();

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
        {isLoading ? "Učitavanje..." : (familyName ?? "Porodica")}
      </h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Dobrodošli nazad! Pregled nadolazećih obaveza.
      </p>
    </div>
  );
}
