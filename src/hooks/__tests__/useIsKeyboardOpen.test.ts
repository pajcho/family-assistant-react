import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIsKeyboardOpen } from "@/hooks/useIsKeyboardOpen";

/**
 * The mobile bottom nav unmounts while this reads true, so a stuck `true` is
 * the nav going missing for the rest of the session - which is exactly what
 * happened when a dialog closed with its autofocused field still focused.
 */
describe("useIsKeyboardOpen", () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    vi.useFakeTimers();
    input = document.createElement("input");
    document.body.append(input);
  });

  afterEach(() => {
    input.remove();
    vi.useRealTimers();
  });

  it("follows focus in and out of a text field", () => {
    const { result } = renderHook(() => useIsKeyboardOpen());
    expect(result.current).toBe(false);

    act(() => input.focus());
    expect(result.current).toBe(true);

    act(() => input.blur());
    expect(result.current).toBe(false);
  });

  it("recovers when the focused field is removed without a focusout", () => {
    const { result } = renderHook(() => useIsKeyboardOpen());

    act(() => input.focus());
    expect(result.current).toBe(true);

    // A closing dialog takes its form with it. Browsers fire no focusout for
    // a removed element, so only the re-check below can clear the signal.
    act(() => input.remove());
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(false);
  });
});
