import { createFileRoute } from "@tanstack/react-router";

import { DashboardScope } from "@/components/dashboard/DashboardScope";
import { LegacyScreen } from "@/components/layout/AppScreen";

/** "Danas" - today's agenda + overdue. Uskoro is its own route (`/uskoro`); the
 *  nav switches between them. */
export const Route = createFileRoute("/_app/")({
  component: () => (
    <LegacyScreen>
      <DashboardScope scope="danas" />
    </LegacyScreen>
  ),
});
