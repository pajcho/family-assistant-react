import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy route. Plaćanja is now a view of Novac. Kept as a redirect: payment
 * reminder push notifications deep-link to `/payments`, and those links live
 * on people's phones long after a deploy.
 */
export const Route = createFileRoute("/_app/payments")({
  beforeLoad: () => {
    throw redirect({ to: "/novac", search: { tab: "placanja" }, replace: true });
  },
});
