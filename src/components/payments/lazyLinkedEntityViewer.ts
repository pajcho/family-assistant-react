import { lazy } from "react";

/**
 * The linked-entity detail viewer as a lazy chunk.
 *
 * Not a bundle-size call - a static import would be a module CYCLE. The payment
 * sheet opens the linked event/activity/birthday's detail sheet, and each of
 * those lists its own linked money, whose rows open the payment sheet again
 * (`LinkedMoneyViewer`). The recursion is real and intended in the UI; the
 * dynamic import is what keeps it out of the module graph, where it would
 * resolve to `undefined` at init time and blank the screen.
 */
export const LinkedEntityViewer = lazy(() => import("@/components/payments/LinkedEntityViewer"));
