import { describe, expect, it } from "vitest";

import {
  buildJevRequest,
  CONFIDENCE_THRESHOLD,
  decideCategory,
  isFatalJevStatus,
  MAX_SIBLINGS,
} from "./shopCategories.ts";

describe("decideCategory", () => {
  it("files a confident answer where the model put it", () => {
    expect(decideCategory({ choice: "dairy", confidence: 0.97 })).toEqual({
      category: "dairy",
      confidence: 0.97,
    });
  });

  it("files an unsure answer as other, keeping the confidence for re-tuning", () => {
    expect(decideCategory({ choice: "drinks", confidence: 0.38 })).toEqual({
      category: "other",
      confidence: 0.38,
    });
  });

  it("trusts an answer exactly at the threshold", () => {
    expect(decideCategory({ choice: "pantry", confidence: CONFIDENCE_THRESHOLD })?.category).toBe(
      "pantry",
    );
  });

  // null leaves the row unfiled, which is retried later; "other" would stick.
  it("refuses to decide on an answer it cannot trust", () => {
    expect(decideCategory(undefined)).toBeNull();
    expect(decideCategory("dairy")).toBeNull();
    expect(decideCategory({ choice: "dairy" })).toBeNull();
    expect(decideCategory({ choice: "dairy", confidence: Number.NaN })).toBeNull();
    expect(decideCategory({ choice: "toString", confidence: 0.9 })).toBeNull();
    expect(decideCategory({ choice: "electronics", confidence: 0.9 })).toBeNull();
  });

  it("clamps a confidence outside 0..1", () => {
    expect(decideCategory({ choice: "bakery", confidence: 1.2 })?.confidence).toBe(1);
  });
});

describe("buildJevRequest", () => {
  it("sends the entry with its list as context, capped so no list can blow the budget", () => {
    const siblings = Array.from({ length: MAX_SIBLINGS + 10 }, (_, i) => `item ${i}`);
    const request = buildJevRequest("  Persun  ", "Shopping", [...siblings, "x".repeat(500)]);

    expect(request.state.new_entry).toBe("Persun");
    expect(request.state.list_name).toBe("Shopping");
    expect(request.state.items_already_on_this_list).toHaveLength(MAX_SIBLINGS);
    expect(request.questions.category.instructions).toContain('"Persun"');
  });

  it("trims every sibling name to a bounded length", () => {
    const request = buildJevRequest("Mleko", "Shopping", ["y".repeat(500)]);
    expect(request.state.items_already_on_this_list[0].length).toBeLessThan(500);
  });
});

describe("isFatalJevStatus", () => {
  it("stops the batch on a key or balance problem, but not on a per-call failure", () => {
    expect([401, 402, 403].every(isFatalJevStatus)).toBe(true);
    expect([400, 408, 429, 500, 503].some(isFatalJevStatus)).toBe(false);
  });
});
