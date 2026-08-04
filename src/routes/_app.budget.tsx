import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy route. Budžet is now the Pregled view of Novac. Kept as a redirect
 * for bookmarks, "Nedavno" entries and the digest's links.
 */
export const Route = createFileRoute("/_app/budget")({
  beforeLoad: () => {
    throw redirect({ to: "/novac", search: { tab: "pregled" }, replace: true });
  },
});
