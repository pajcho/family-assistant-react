import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Vite injects BASE_URL: "/" in dev, "/family-assistant-react/" in prod.
// Strip the trailing slash and fall back to "/" so TanStack Router strips
// the prefix from the URL when matching routes on GH Pages.
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  basepath: import.meta.env.BASE_URL.replace(/\/$/, "") || "/",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return <RouterProvider router={router} />;
}
