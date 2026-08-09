import { describe, expect, it } from "vitest";

import { createErrorToastGate } from "@/lib/errorToastGate";

describe("createErrorToastGate", () => {
  it("lets the first failure through", () => {
    const shouldToast = createErrorToastGate(15_000, () => 0);
    expect(shouldToast()).toBe(true);
  });

  it("swallows a burst inside the window", () => {
    let clock = 1_000;
    const shouldToast = createErrorToastGate(15_000, () => clock);
    expect(shouldToast()).toBe(true);
    expect(shouldToast()).toBe(false);
    clock = 5_000;
    expect(shouldToast()).toBe(false);
    clock = 15_999;
    expect(shouldToast()).toBe(false);
  });

  it("lets a failure through once the window has passed", () => {
    let clock = 1_000;
    const shouldToast = createErrorToastGate(15_000, () => clock);
    expect(shouldToast()).toBe(true);
    clock = 16_000;
    expect(shouldToast()).toBe(true);
    expect(shouldToast()).toBe(false);
    clock = 31_000;
    expect(shouldToast()).toBe(true);
  });

  it("keeps separate gates independent", () => {
    const a = createErrorToastGate(15_000, () => 0);
    const b = createErrorToastGate(15_000, () => 0);
    expect(a()).toBe(true);
    expect(b()).toBe(true);
    expect(a()).toBe(false);
  });
});
