import { createFileRoute } from "@tanstack/react-router";

import { DashboardScope } from "@/components/dashboard/DashboardScope";

/** "Danas" — today's agenda + overdue. Uskoro is its own route (`/uskoro`); the
 *  nav switches between them. */
export const Route = createFileRoute("/_app/")({
  component: () => <DashboardScope scope="danas" />,
});
