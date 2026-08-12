import { createFileRoute } from "@tanstack/react-router";

import { CompletedTasksScreen } from "@/components/tasks/CompletedTasksScreen";

/**
 * `/tasks/done` - "Završeno", the cut that looks backwards.
 *
 * A static segment like the other three, so it can never collide with a list id.
 * This one does NOT render `SmartTaskListScreen`: it groups by the day a task
 * was ticked rather than the day it is due, which is a different screen, not a
 * different source.
 */
export const Route = createFileRoute("/_app/tasks/done")({
  component: CompletedTasksRoute,
});

function CompletedTasksRoute() {
  return <CompletedTasksScreen />;
}
