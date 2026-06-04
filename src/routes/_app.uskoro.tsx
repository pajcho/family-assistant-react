import { createFileRoute } from "@tanstack/react-router";

import { DashboardScope } from "@/components/dashboard/DashboardScope";

/** "Uskoro" — everything from today onward (list or weekly calendar). Shares the
 *  dashboard shell with Danas (`/`); the nav switches between them. */
export const Route = createFileRoute("/_app/uskoro")({
  component: () => <DashboardScope scope="uskoro" />,
});
