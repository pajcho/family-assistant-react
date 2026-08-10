import { createFileRoute } from "@tanstack/react-router";

import { SmartTaskListScreen } from "@/components/tasks/SmartTaskListScreen";

/**
 * `/tasks/mine` - the "Meni dodeljeno" cut across every list.
 *
 * A static segment, so it can never collide with a list id and the URL stays
 * readable. All four smart lists render the SAME screen component with a
 * different source; the route file exists only to name the entry point.
 */
export const Route = createFileRoute("/_app/tasks/mine")({
  component: MineTasksRoute,
});

function MineTasksRoute() {
  return <SmartTaskListScreen source="mine" />;
}
