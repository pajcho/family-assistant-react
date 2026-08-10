import { createFileRoute } from "@tanstack/react-router";

import { KidUpcomingView } from "@/components/kid/KidUpcomingView";

/** Upcoming. See `KidUpcomingView` - shared with the parent-side preview. */
export const Route = createFileRoute("/kid/upcoming")({
  component: KidUpcomingView,
});
