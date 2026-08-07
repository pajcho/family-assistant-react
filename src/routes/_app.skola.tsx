import { createFileRoute } from "@tanstack/react-router";

import { SchoolScreen } from "@/components/school/SchoolScreen";

/**
 * "Škola" - the timetable, smene, bell schedule and raspusti, promoted out of
 * the gear button in the Aktivnosti header into a destination of its own.
 *
 * The path is Serbian (`/skola`) like `/kalendar` and `/novac`; the section KEY
 * stays English (`school`) because that one is persisted in `profiles.nav_slots`
 * and in per-device "Nedavno".
 */
export const Route = createFileRoute("/_app/skola")({
  component: SchoolScreen,
});
