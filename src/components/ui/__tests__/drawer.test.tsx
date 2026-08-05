import { useState } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

function PlainDrawer({ open }: { open: boolean }) {
  return (
    <ResponsiveDialog open={open} onOpenChange={() => undefined}>
      <ResponsiveDialogContent>
        <ResponsiveDialogTitle>Test drawer</ResponsiveDialogTitle>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function StackDrawer() {
  const [open, setOpen] = useState(true);
  const stack = useSheetStack(open, setOpen, "root");

  return (
    <SheetStackViews
      stack={stack}
      render={(view, level) => (
        <ResponsiveDialogContent>
          <SheetStackHeader title={view} />
          {level === 0 ? (
            <button type="button" onClick={() => stack.push("sub")}>
              Open sub-view
            </button>
          ) : (
            <button type="button" onClick={() => stack.dismiss(level)}>
              Dismiss sub-view
            </button>
          )}
        </ResponsiveDialogContent>
      )}
    />
  );
}

describe("Drawer scroll lock", () => {
  afterEach(() => {
    act(() => vi.runAllTimers());
    vi.useRealTimers();
    document.documentElement.classList.remove("dialog-open");
  });

  it("locks again when the same drawer is closed and reopened", () => {
    vi.useFakeTimers();
    const { rerender } = render(<PlainDrawer open />);

    expect(document.documentElement).toHaveClass("dialog-open");

    rerender(<PlainDrawer open={false} />);
    expect(document.documentElement).toHaveClass("dialog-open");

    act(() => vi.advanceTimersByTime(500));
    expect(document.documentElement).not.toHaveClass("dialog-open");

    rerender(<PlainDrawer open />);
    expect(document.documentElement).toHaveClass("dialog-open");
  });

  it("keeps the page locked while a stacked sub-view opens and closes over it", () => {
    vi.useFakeTimers();
    const { getByRole, getByText } = render(<StackDrawer />);

    // Two overlays open at once. The sub-view sits ON TOP of the root, so Radix
    // marks the root `aria-hidden` - hence `getByText`, not `getByRole`, for the
    // covered level. The scroll lock is reference counted, so the sub-view
    // closing must not release it while the root is still up.
    fireEvent.click(getByRole("button", { name: "Open sub-view" }));
    expect(getByRole("heading", { name: "sub" })).toBeInTheDocument();
    expect(getByText("root")).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dialog-open");

    fireEvent.click(getByRole("button", { name: "Dismiss sub-view" }));
    expect(getByText("root")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(500));
    expect(document.documentElement).toHaveClass("dialog-open");
  });
});
