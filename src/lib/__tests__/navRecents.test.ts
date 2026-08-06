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
    recordNavRecent("money");
    recordNavRecent("events");
    expect(readNavRecents()).toEqual(["events", "money"]);
  });

  it("moves a repeated visit to the front instead of duplicating", () => {
    recordNavRecent("money");
    recordNavRecent("events");
    recordNavRecent("money");
    expect(readNavRecents()).toEqual(["money", "events"]);
  });

  it("caps the stored list", () => {
    for (const key of [
      "today",
      "calendar",
      "activities",
      "events",
      "birthdays",
      "money",
      "lists",
    ] as const) {
      recordNavRecent(key);
    }
    const recents = readNavRecents();
    expect(recents).toHaveLength(6);
    expect(recents[0]).toBe("lists");
    expect(recents).not.toContain("today");
  });

  it("maps pre-redesign keys forward and dedupes the collapsed ones", () => {
    window.localStorage.setItem(
      "nav.recents.v1",
      JSON.stringify(["uskoro", "payments", "budget", "lists"]),
    );
    expect(readNavRecents()).toEqual(["calendar", "money", "lists"]);
  });

  it("ignores garbage in storage", () => {
    window.localStorage.setItem("nav.recents.v1", "not json");
    expect(readNavRecents()).toEqual([]);
    window.localStorage.setItem("nav.recents.v1", JSON.stringify(["nope", 5, "money"]));
    expect(readNavRecents()).toEqual(["money"]);
  });
});
