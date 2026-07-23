import { describe, expect, it } from "vitest";
import { serbianPlural, stavkeLabel } from "../plural";

describe("stavkeLabel", () => {
  it('uses "stavka" for n ending in 1 (except 11)', () => {
    for (const n of [1, 21, 31, 101, 201, 1001]) {
      expect(stavkeLabel(n)).toBe("stavka");
    }
  });

  it('uses "stavke" for n ending in 2-4 (except 12-14)', () => {
    for (const n of [2, 3, 4, 22, 23, 24, 34, 202, 1003]) {
      expect(stavkeLabel(n)).toBe("stavke");
    }
  });

  it('uses "stavki" for everything else (0, 5-9, and the 11-14 teens)', () => {
    for (const n of [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 25, 100, 110, 111, 112]) {
      expect(stavkeLabel(n)).toBe("stavki");
    }
  });
});

describe("serbianPlural", () => {
  const forms = { one: "sat", few: "sata", many: "sati" };

  it("picks the right paucal form", () => {
    expect(serbianPlural(1, forms)).toBe("sat");
    expect(serbianPlural(2, forms)).toBe("sata");
    expect(serbianPlural(5, forms)).toBe("sati");
    expect(serbianPlural(11, forms)).toBe("sati");
    expect(serbianPlural(21, forms)).toBe("sat");
  });
});
