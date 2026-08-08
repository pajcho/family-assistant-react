import { createFileRoute } from "@tanstack/react-router";

import { KidFamilyView } from "@/components/kid/KidFamilyView";

/** Porodica. See `KidFamilyView` - shared with the parent-side preview. */
export const Route = createFileRoute("/kid/porodica")({
  component: KidFamilyView,
});
