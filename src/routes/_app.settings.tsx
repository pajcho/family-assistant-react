import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { SettingsScreen, type SettingsSection } from "@/components/settings/SettingsScreen";

/**
 * Settings. The redesign folded the old /profile page into this route and
 * turned the tab strip into a hub of grouped rows, but the URL contract is
 * unchanged: `?tab=<section>` deep-links straight into a sub-screen (the menu
 * grid links to `?tab=family`), and the Google OAuth callback still returns
 * with `?gcal=connected|error`.
 */

const SECTIONS: readonly SettingsSection[] = [
  "profile",
  "family",
  "currencies",
  "notifications",
  "calendar",
];

function isSection(value: unknown): value is SettingsSection {
  return typeof value === "string" && (SECTIONS as readonly string[]).includes(value);
}

export const Route = createFileRoute("/_app/settings")({
  // Deep-linkable sub-screen. Missing = the hub itself. `gcal`/`reason` are
  // the one-shot flags the Google OAuth callback redirects back with - kept in
  // the schema so the screen can read and then clear them. `member` preselects
  // a member inside `?tab=family` (that master-detail keeps its selection in
  // local state), which is how leaving the kid preview gets back to the child
  // it was previewing rather than to the roster.
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    tab?: SettingsSection;
    gcal?: "connected" | "error";
    reason?: string;
    member?: string;
  } => {
    const raw = search.tab;
    const result: {
      tab?: SettingsSection;
      gcal?: "connected" | "error";
      reason?: string;
      member?: string;
    } = {};
    if (isSection(raw)) {
      result.tab = raw;
    } else if (raw != null) {
      // Unknown values must be *normalized*, not just dropped: the router
      // merges this result over the parent match's raw search
      // (`{ ...parentSearch, ...validated }`), so omitting the key would leak
      // the raw URL value through. An explicit undefined overwrites it and
      // lands on the hub.
      result.tab = undefined;
    }
    if (search.gcal === "connected" || search.gcal === "error") result.gcal = search.gcal;
    if (typeof search.reason === "string") result.reason = search.reason;
    if (typeof search.member === "string") result.member = search.member;
    return result;
  },
  component: SettingsRoute,
});

function SettingsRoute() {
  const { tab, gcal, reason, member } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <SettingsScreen
      section={tab ?? null}
      gcal={gcal}
      reason={reason}
      memberId={member}
      onOpenSection={(next) => void navigate({ to: "/settings", search: { tab: next } })}
      onBack={() => void navigate({ to: "/settings", search: {} })}
      onGcalHandled={() =>
        void navigate({ to: "/settings", search: { tab: "calendar" }, replace: true })
      }
    />
  );
}
