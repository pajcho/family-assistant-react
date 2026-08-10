import { createFileRoute } from "@tanstack/react-router";

import { KidFamilyView } from "@/components/kid/KidFamilyView";

/** Family. See `KidFamilyView` - shared with the parent-side preview. */
export const Route = createFileRoute("/kid/family")({
  component: KidFamilyView,
});
