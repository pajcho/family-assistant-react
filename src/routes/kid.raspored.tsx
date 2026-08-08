import { createFileRoute } from "@tanstack/react-router";

import { KidScheduleView } from "@/components/kid/KidScheduleView";

/** Raspored. See `KidScheduleView` - shared with the parent-side preview. */
export const Route = createFileRoute("/kid/raspored")({
  component: KidScheduleView,
});
