import { createFileRoute } from "@tanstack/react-router";

import { KidTodayView } from "@/components/kid/KidTodayView";

/**
 * Danas. The screen itself is a component so `/kid/preview` can render the very
 * same one for a parent looking at their child's app.
 */
export const Route = createFileRoute("/kid/")({
  component: KidTodayView,
});
