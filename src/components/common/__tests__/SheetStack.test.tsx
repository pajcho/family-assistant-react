import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSheetStack } from "@/components/common/SheetStack";

function StackHarness() {
  const [open, setOpen] = useState(true);
  const { view, atRoot, push, pop, dialogOpen, dialogKey, handleOpenChange } = useSheetStack(
    open,
    setOpen,
    "root",
  );

  return (
    <div>
      <output aria-label="view">{view}</output>
      <output aria-label="owner-open">{String(open)}</output>
      <output aria-label="dialog-open">{String(dialogOpen)}</output>
      <output aria-label="at-root">{String(atRoot)}</output>
      <output aria-label="dialog-key">{dialogKey}</output>
      <button type="button" onClick={() => push("first")}>
        Push first
      </button>
      <button type="button" onClick={() => push("second")}>
        Push second
      </button>
      <button type="button" onClick={pop}>
        Back
      </button>
      <button type="button" onClick={() => handleOpenChange(false)}>
        Dismiss
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Owner close
      </button>
    </div>
  );
}

function output(name: string) {
  return screen.getByRole("status", { name }).textContent;
}

function mockDesktop() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn<(query: string) => MediaQueryList>().mockImplementation(
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: vi.fn<() => void>(),
          removeEventListener: vi.fn<() => void>(),
          addListener: vi.fn<() => void>(),
          removeListener: vi.fn<() => void>(),
          dispatchEvent: vi.fn<() => boolean>(),
        }) as unknown as MediaQueryList,
    ),
  );
}

describe("useSheetStack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => vi.runAllTimers());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("closes the owner when the root view is dismissed", () => {
    render(<StackHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(output("owner-open")).toBe("false");
    expect(output("dialog-open")).toBe("false");
    expect(output("view")).toBe("root");
  });

  it("pops one mobile level after a dismiss and remounts the drawer", () => {
    render(<StackHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Push first" }));
    fireEvent.click(screen.getByRole("button", { name: "Push second" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(output("view")).toBe("second");
    expect(output("owner-open")).toBe("true");
    expect(output("dialog-open")).toBe("false");

    act(() => vi.advanceTimersByTime(200));

    expect(output("view")).toBe("first");
    expect(output("dialog-open")).toBe("true");
    expect(output("dialog-key")).toBe("1");
    expect(output("at-root")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    act(() => vi.advanceTimersByTime(200));

    expect(output("view")).toBe("root");
    expect(output("owner-open")).toBe("true");
    expect(output("dialog-key")).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(output("owner-open")).toBe("false");
  });

  it("pops a desktop sub-view in place without closing the dialog", () => {
    mockDesktop();
    render(<StackHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Push first" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(output("view")).toBe("root");
    expect(output("owner-open")).toBe("true");
    expect(output("dialog-open")).toBe("true");
    expect(output("dialog-key")).toBe("0");
  });

  it("cancels a pending mobile reopen when the owner closes", () => {
    render(<StackHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Push first" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.click(screen.getByRole("button", { name: "Owner close" }));

    act(() => vi.advanceTimersByTime(200));

    expect(output("owner-open")).toBe("false");
    expect(output("dialog-open")).toBe("false");
    expect(output("view")).toBe("root");
    expect(output("dialog-key")).toBe("0");
  });
});
