import { createFileRoute } from "@tanstack/react-router";

import { KidUpcomingView } from "@/components/kid/KidUpcomingView";

/** Uskoro. See `KidUpcomingView` - shared with the parent-side preview. */
export const Route = createFileRoute("/kid/uskoro")({
  component: KidUpcomingView,
});
