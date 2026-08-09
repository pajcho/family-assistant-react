import { describe, expect, it } from "vitest";

import { visibleMemberCount } from "@/utils/memberAvatar";

/**
 * The "+1" rule: a five-member event used to render four faces and a "+1"
 * chip, which spends a whole slot to hide exactly one person. The chip only
 * earns its place once it stands for two or more.
 */
describe("visibleMemberCount", () => {
  const max = 5;
  const overflow = (count: number) => count - visibleMemberCount(count, max);

  it("shows everyone while they fit in the slots", () => {
    expect(visibleMemberCount(1, max)).toBe(1);
    expect(visibleMemberCount(4, max)).toBe(4);
    expect(visibleMemberCount(5, max)).toBe(5);
    expect(overflow(5)).toBe(0);
  });

  it("never renders a chip that stands for one person", () => {
    for (let count = 1; count <= 20; count++) expect(overflow(count)).not.toBe(1);
  });

  it("gives the last slot to the chip once there are too many", () => {
    expect(visibleMemberCount(6, max)).toBe(4);
    expect(overflow(6)).toBe(2);
    expect(visibleMemberCount(7, max)).toBe(4);
    expect(overflow(7)).toBe(3);
  });

  it("holds for the tighter caps the pickers use", () => {
    expect(visibleMemberCount(3, 3)).toBe(3);
    expect(visibleMemberCount(4, 3)).toBe(2);
    expect(4 - visibleMemberCount(4, 3)).toBe(2);
  });
});
