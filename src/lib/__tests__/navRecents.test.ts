import { beforeEach, describe, expect, it } from "vitest";

import { readNavRecents, recordNavRecent } from "@/lib/navRecents";

describe("navRecents", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts empty", () => {
    expect(readNavRecents()).toEqual([]);
  });

  it("records most-recent-first", () => {
    recordNavRecent("budget");
    recordNavRecent("events");
    expect(readNavRecents()).toEqual(["events", "budget"]);
  });

  it("moves a repeated visit to the front instead of duplicating", () => {
    recordNavRecent("budget");
    recordNavRecent("events");
    recordNavRecent("budget");
    expect(readNavRecents()).toEqual(["budget", "events"]);
  });

  it("caps the stored list", () => {
    for (const key of [
      "danas",
      "uskoro",
      "activities",
      "events",
      "payments",
      "budget",
      "lists",
    ] as const) {
      recordNavRecent(key);
    }
    const recents = readNavRecents();
    expect(recents).toHaveLength(6);
    expect(recents[0]).toBe("lists");
    expect(recents).not.toContain("danas");
  });

  it("ignores garbage in storage", () => {
    window.localStorage.setItem("nav.recents.v1", "not json");
    expect(readNavRecents()).toEqual([]);
    window.localStorage.setItem("nav.recents.v1", JSON.stringify(["nope", 5, "budget"]));
    expect(readNavRecents()).toEqual(["budget"]);
  });
});
