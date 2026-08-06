import { createFileRoute } from "@tanstack/react-router";

import { TodayScreen } from "@/components/dashboard/TodayScreen";

/** "Danas" - one timeline for today, with overdue money pinned above it. */
export const Route = createFileRoute("/_app/")({
  component: TodayScreen,
});
