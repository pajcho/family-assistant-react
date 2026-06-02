import { Outlet, createFileRoute } from "@tanstack/react-router";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";

import { ListMaster } from "@/components/lists/ListMaster";
import { useIsWide } from "@/hooks/useIsWide";

/**
 * Layout route for `/lists/*` — the Apple Notes-style master-detail shell.
 *
 * Mobile (< lg): renders just `<Outlet/>`. The index route shows the
 * full-screen master list; the detail route shows the full-screen list page.
 *
 * Desktop (>= lg): renders a *persistent* split — the list sidebar on the left
 * (always mounted, survives navigation between lists) and the selected list's
 * detail in the right panel via `<Outlet/>`. The divider is draggable and its
 * position is remembered per-device in localStorage.
 */
export const Route = createFileRoute("/_app/lists")({
  component: ListsLayout,
});

function ListsLayout() {
  const isWide = useIsWide();
  return isWide ? <ListsSplit /> : <Outlet />;
}

function ListsSplit() {
  // react-resizable-panels v4 has no `autoSaveId`; `useDefaultLayout` wires
  // `defaultLayout` (hydrate) + `onLayoutChanged` (save-on-pointer-release) to
  // localStorage for us. The Panels carry stable ids so the persisted map
  // ({ master, detail } → percentage) maps back correctly across reloads.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "lists.split.v1",
    storage: window.localStorage,
  });

  return (
    // Fill the viewport below the sticky 56px nav, minus <main>'s pt-6 + pb-6
    // (24px each) = 6.5rem — so the page itself never scrolls on /lists at lg;
    // each panel scrolls internally instead. `100dvh` (not vh) keeps it stable
    // against mobile URL-bar / safe-area changes.
    <div className="h-[calc(100dvh-6.5rem)] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
      <Group
        orientation="horizontal"
        className="h-full"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <Panel
          id="master"
          defaultSize="320px"
          minSize="240px"
          maxSize="480px"
          // Keep the sidebar a constant pixel width when the window resizes;
          // the detail panel (preserve-relative-size, the default) absorbs the
          // change. Matches how a desktop notes sidebar behaves.
          groupResizeBehavior="preserve-pixel-size"
          className="h-full overflow-hidden"
        >
          <ListMaster variant="sidebar" />
        </Panel>

        {/* 8px-wide transparent grab strip with a 1px hairline down the middle;
            the library extends the actual hit target for comfortable dragging.
            Tints on hover and while dragging (:active). */}
        <Separator className="group relative w-2 cursor-col-resize bg-transparent outline-none">
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-200 transition-colors group-hover:bg-blue-400 group-active:bg-blue-500 dark:bg-gray-700 dark:group-hover:bg-blue-500" />
        </Separator>

        <Panel
          id="detail"
          minSize="360px"
          className="h-full overflow-y-auto bg-white p-6 dark:bg-gray-800"
        >
          <Outlet />
        </Panel>
      </Group>
    </div>
  );
}
