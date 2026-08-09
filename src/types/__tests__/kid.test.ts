import { describe, expect, it } from "vitest";

import { isKidShellPath } from "@/types/kid";

/**
 * The `/kid/pregled` exclusion is the whole reason this predicate exists, and
 * it is invisible from the call sites: a parent previewing their child's app is
 * still a parent, so nothing addressed to a child may reach that screen.
 *
 * `src/lib/__tests__/kidInstallIdentity.test.ts` pins the same rule for the
 * copy of it that gets stringified into `index.html`. The two are tested apart
 * on purpose - if they ever disagree, both suites should say so.
 */
describe("isKidShellPath", () => {
  it("is true across the kid shell", () => {
    expect(isKidShellPath("/kid")).toBe(true);
    expect(isKidShellPath("/kid/")).toBe(true);
    expect(isKidShellPath("/kid/login")).toBe(true);
    expect(isKidShellPath("/kid/veza")).toBe(true);
    expect(isKidShellPath("/kid/raspored")).toBe(true);
  });

  it("is false on the parent's preview of it", () => {
    expect(isKidShellPath("/kid/pregled")).toBe(false);
  });

  it("is false everywhere in the grown-up app", () => {
    expect(isKidShellPath("/")).toBe(false);
    expect(isKidShellPath("/novac")).toBe(false);
    expect(isKidShellPath("/login")).toBe(false);
  });

  it("does not match a route that merely starts with the same letters", () => {
    expect(isKidShellPath("/kidney")).toBe(false);
    expect(isKidShellPath("/kid-mode")).toBe(false);
  });
});
