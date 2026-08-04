import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy route. "Uskoro" became the Agenda view of Kalendar in the redesign.
 * Kept as a redirect because it is baked into push-notification deep links,
 * per-device "Nedavno" entries and anything the user bookmarked.
 */
export const Route = createFileRoute("/_app/uskoro")({
  beforeLoad: () => {
    throw redirect({ to: "/kalendar", search: { view: "agenda" }, replace: true });
  },
});
