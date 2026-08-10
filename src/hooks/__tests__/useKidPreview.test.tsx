import { describe, expect, it } from "vitest";

import { kidPreviewExit } from "@/hooks/useKidPreview";

/**
 * The way out of the preview is a navigate TARGET, not a path, and the whole
 * thing has to survive the trip.
 *
 * It has been got wrong once already: pulling `to` out and dropping `search`
 * navigates to `/settings` with no tab, which lands the parent on the settings
 * hub rather than back on Porodica where they pressed the button. These tests
 * pin the shape so a caller that destructures it loses a test, not a user.
 */
describe("kidPreviewExit", () => {
  it("carries the family tab, not just the settings route", () => {
    expect(kidPreviewExit("kid-1")).toEqual({
      to: "/settings",
      search: { tab: "family", member: "kid-1" },
    });
  });

  it("carries the child back, so the master-detail reopens on them", () => {
    expect(kidPreviewExit("kid-1").search.member).toBe("kid-1");
  });

  it("omits the child when there is not one to go back to", () => {
    // The rejection path: the id in the URL was the problem, so sending it
    // back would just ask the family tab to select something that is not there.
    expect(kidPreviewExit()).toEqual({ to: "/settings", search: { tab: "family" } });
    expect(kidPreviewExit(null)).toEqual({ to: "/settings", search: { tab: "family" } });
    expect(kidPreviewExit("")).toEqual({ to: "/settings", search: { tab: "family" } });
  });
});
