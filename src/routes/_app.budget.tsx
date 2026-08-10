import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy route. The budget page is now the overview view of Money. Kept as a
 * redirect for bookmarks, per-device "recent" entries and the digest's links.
 */
export const Route = createFileRoute("/_app/budget")({
  beforeLoad: () => {
    throw redirect({ to: "/money", search: { tab: "overview" }, replace: true });
  },
});
