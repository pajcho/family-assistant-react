import { Outlet, createFileRoute } from "@tanstack/react-router";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";

import { TaskSidebar } from "@/components/tasks/TaskSidebar";
import { useIsWide } from "@/hooks/useIsWide";

/**
 * Layout route for `/tasks/*` - the Apple Notes-style master-detail shell.
 *
 * Mobile (< lg): renders just `<Outlet/>`. The index route shows the full-screen
 * Zadaci overview; the list and smart-list routes show a full-screen list.
 *
 * Desktop (>= lg): renders a *persistent* split - the sidebar on the left
 * (always mounted, survives navigation between lists) and the selected list's
 * detail in the right panel via `<Outlet/>`. The divider is draggable and its
 * position is remembered per-device in localStorage.
 */
export const Route = createFileRoute("/_app/tasks")({
  // `?new=1` deep-links the create-list dialog open - used by the dashboard's
  // "Dodaj → Lista" entry. Lives on the layout route (not the index) so it
  // reaches the sidebar on desktop even while the index route is busy
  // redirecting to a concrete list. Consumed + stripped by `useCreateListFlow`.
  validateSearch: (search: Record<string, unknown>): { new?: boolean } => ({
    new: search.new === true || search.new === 1 || search.new === "1" ? true : undefined,
  }),
  component: TasksLayout,
});

function TasksLayout() {
  // Below lg each child route owns its own <AppScreen> (the overview and a list
  // are separate full screens), so the layout gets out of the way entirely.
  const isWide = useIsWide();
  return isWide ? <TasksSplit /> : <Outlet />;
}

function TasksSplit() {
  // react-resizable-panels v4 has no `autoSaveId`; `useDefaultLayout` wires
  // `defaultLayout` (hydrate) + `onLayoutChanged` (save-on-pointer-release) to
  // localStorage for us. The Panels carry stable ids so the persisted map
  // ({ master, detail } → percentage) maps back correctly across reloads.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "lists.split.v1",
    storage: window.localStorage,
  });

  return (
    // Fills the screen area of the app frame (which is itself fixed at
    // 100dvh), so the page never scrolls on /tasks at lg - each panel scrolls
    // internally instead.
    <div className="h-full overflow-hidden border-t border-border">
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
          <TaskSidebar />
        </Panel>

        {/* 8px-wide transparent grab strip with a 1px hairline down the middle;
            the library extends the actual hit target for comfortable dragging.
            Tints on hover and while dragging (:active). */}
        <Separator className="group relative w-2 cursor-col-resize bg-transparent outline-none">
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-accent group-active:bg-accent" />
        </Separator>

        <Panel id="detail" minSize="360px" className="h-full overflow-y-auto bg-card p-6">
          <Outlet />
        </Panel>
      </Group>
    </div>
  );
}
