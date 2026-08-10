import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy route. Payments is now a view of Money. Kept as a redirect: payment
 * reminder push notifications deep-link to `/payments`, and those links live
 * on people's phones long after a deploy.
 */
export const Route = createFileRoute("/_app/payments")({
  beforeLoad: () => {
    throw redirect({ to: "/money", search: { tab: "payments" }, replace: true });
  },
});
