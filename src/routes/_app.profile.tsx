import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The standalone profile page is gone - the redesign folded identity, theme,
 * accent and logout into the Podešavanja hub. The route stays as a redirect so
 * old bookmarks (and any lingering link) land on the hub instead of a 404.
 */
export const Route = createFileRoute("/_app/profile")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", search: {}, replace: true });
  },
});
