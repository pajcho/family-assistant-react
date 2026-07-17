import { fireEvent, render, screen } from "@testing-library/react";
import { CalendarDaysIcon, TrashIcon } from "@heroicons/react/24/outline";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SheetActionsMenu,
  SheetActionsMobileTrigger,
  type SheetAction,
} from "@/components/common/SheetActions";

function mockMediaQuery(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn<(query: string) => MediaQueryList>().mockImplementation(
      (query: string) =>
        ({
          matches,
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

function renderActions(matches: boolean) {
  mockMediaQuery(matches);
  const openMobileActions = vi.fn<() => void>();
  const reschedule = vi.fn<() => void>();
  const remove = vi.fn<() => void>();
  const items: SheetAction[] = [
    {
      key: "reschedule",
      label: "Pomeri datum",
      icon: CalendarDaysIcon,
      onSelect: reschedule,
    },
    {
      key: "delete",
      label: "Obriši",
      icon: TrashIcon,
      destructive: true,
      separatorBefore: true,
      onSelect: remove,
    },
  ];

  render(
    <>
      <SheetActionsMobileTrigger items={items} onOpenActions={openMobileActions} />
      <SheetActionsMenu items={items} />
    </>,
  );

  return { openMobileActions, reschedule };
}

describe("responsive detail actions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the compact kebab flow on mobile", () => {
    const { openMobileActions } = renderActions(false);

    expect(screen.queryByRole("button", { name: "Opcije" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Više opcija" }));

    expect(openMobileActions).toHaveBeenCalledOnce();
  });

  it("moves actions into a labeled footer menu on desktop", () => {
    const { reschedule } = renderActions(true);

    expect(screen.queryByRole("button", { name: "Više opcija" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "Opcije" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Pomeri datum" }));

    expect(reschedule).toHaveBeenCalledOnce();
  });
});
