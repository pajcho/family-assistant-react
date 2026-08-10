import { createFileRoute } from "@tanstack/react-router";

import { SchoolScreen } from "@/components/school/SchoolScreen";

/**
 * School - the timetable, A/B shifts, bell schedule and school breaks,
 * promoted out of the gear button in the activities header into a destination
 * of its own.
 */
export const Route = createFileRoute("/_app/school")({
  component: SchoolScreen,
});
