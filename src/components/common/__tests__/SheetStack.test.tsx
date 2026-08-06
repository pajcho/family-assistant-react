import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSheetStack } from "@/components/common/SheetStack";

function StackHarness() {
  const [open, setOpen] = useState(true);
  const { view, atRoot, levels, depth, push, pop, dismiss } = useSheetStack(open, setOpen, "root");

  return (
    <div>
      <output aria-label="view">{view}</output>
      <output aria-label="owner-open">{String(open)}</output>
      <output aria-label="at-root">{String(atRoot)}</output>
      <output aria-label="depth">{depth}</output>
      <output aria-label="levels">{levels.join(",")}</output>
      <button type="button" onClick={() => push("first")}>
        Push first
      </button>
      <button type="button" onClick={() => push("second")}>
        Push second
      </button>
      <button type="button" onClick={pop}>
        Back
      </button>
      <button type="button" onClick={() => dismiss(depth - 1)}>
        Dismiss top
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Owner close
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        Owner open
      </button>
    </div>
  );
}

function output(name: string) {
  return screen.getByRole("status", { name }).textContent;
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("useSheetStack", () => {
  it("closes the owner when the root level is dismissed", () => {
    render(<StackHarness />);

    click("Dismiss top");

    expect(output("owner-open")).toBe("false");
    expect(output("view")).toBe("root");
  });

  it("pops one level per dismissal without closing the flow", () => {
    render(<StackHarness />);

    click("Push first");
    click("Push second");
    expect(output("view")).toBe("second");
    expect(output("depth")).toBe("3");

    click("Dismiss top");
    expect(output("view")).toBe("first");
    expect(output("owner-open")).toBe("true");
    expect(output("at-root")).toBe("false");

    click("Dismiss top");
    expect(output("view")).toBe("root");
    expect(output("owner-open")).toBe("true");

    click("Dismiss top");
    expect(output("owner-open")).toBe("false");
  });

  it("keeps a popped level mounted so its exit animation can play", () => {
    render(<StackHarness />);

    click("Push first");
    click("Back");

    expect(output("depth")).toBe("1");
    // Still rendered (closed, not removed) - the drawer needs it to animate out.
    expect(output("levels")).toBe("root,first");
  });

  it("replaces a popped sibling instead of stacking beside it", () => {
    render(<StackHarness />);

    click("Push first");
    click("Back");
    click("Push second");

    expect(output("levels")).toBe("root,second");
    expect(output("depth")).toBe("2");
  });

  it("rearms on the next open, not while closing", () => {
    render(<StackHarness />);

    click("Push first");
    click("Owner close");

    // Closing leaves the stack alone: every level animates out together, and
    // pulling their content mid-exit is what used to strand a half-open drawer.
    expect(output("depth")).toBe("2");
    expect(output("levels")).toBe("root,first");

    click("Owner open");
    expect(output("depth")).toBe("1");
    expect(output("view")).toBe("root");
  });
});
