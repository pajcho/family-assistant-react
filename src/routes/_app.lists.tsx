import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout route for `/lists/*`.
 *
 * TanStack Router's flat-file plugin makes `_app.lists.tsx` the implicit
 * parent of any `_app.lists.<something>.tsx` sibling. For the child to
 * render, the parent must render an <Outlet />. We deliberately keep this
 * file empty of UI — the overview at `/lists` lives in `_app.lists.index.tsx`
 * and the per-list detail at `/lists/$listId` lives in `_app.lists.$listId.tsx`.
 * That way the detail view fully replaces the overview rather than nesting
 * inside it.
 */
export const Route = createFileRoute("/_app/lists")({
  component: ListsLayout,
});

function ListsLayout() {
  return <Outlet />;
}
