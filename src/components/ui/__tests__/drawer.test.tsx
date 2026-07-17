import { useState } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SheetStackHeader, useSheetStack } from "@/components/common/SheetStack";
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
  const { view, atRoot, push, dialogOpen, dialogKey, handleOpenChange } = useSheetStack(
    open,
    setOpen,
    "root",
  );

  return (
    <ResponsiveDialog key={dialogKey} open={dialogOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <SheetStackHeader title={view} />
        {atRoot ? (
          <button type="button" onClick={() => push("sub")}>
            Open sub-view
          </button>
        ) : (
          <button type="button" onClick={() => handleOpenChange(false)}>
            Dismiss sub-view
          </button>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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

  it("keeps the page locked through a SheetStack dismiss and remount", () => {
    vi.useFakeTimers();
    const { getByRole } = render(<StackDrawer />);

    fireEvent.click(getByRole("button", { name: "Open sub-view" }));
    fireEvent.click(getByRole("button", { name: "Dismiss sub-view" }));

    act(() => vi.advanceTimersByTime(200));
    expect(getByRole("heading", { name: "root" })).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dialog-open");

    act(() => vi.advanceTimersByTime(300));
    expect(document.documentElement).toHaveClass("dialog-open");
  });
});
