import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "@/hooks/useDebouncedValue";

/**
 * Guards the property the Novac search leans on: a burst of keystrokes emits
 * ONE settled value, not one per character.
 */
describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initial value straight away", () => {
    const { result } = renderHook(() => useDebouncedValue("kafa", 250));

    expect(result.current).toBe("kafa");
  });

  it("holds the old value until the delay has passed", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: "" },
    });

    rerender({ value: "kaf" });
    expect(result.current).toBe("");

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("kaf");
  });

  it("restarts the window on every change, so a burst settles once", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: "" },
    });

    for (const value of ["k", "ka", "kaf", "kafa"]) {
      rerender({ value });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current).toBe("");
    }

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe("kafa");
  });

  it("drops its pending timer on unmount", () => {
    const { unmount } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: "kafa" },
    });

    unmount();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    // A surviving timer would setState on an unmounted hook.
    expect(vi.getTimerCount()).toBe(0);
  });
});
