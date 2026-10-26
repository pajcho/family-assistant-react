import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Node 25+ ships a global Web Storage API. Without `--localstorage-file`
    // its `localStorage` is undefined, and it shadows the jsdom one the tests
    // rely on, so turn it off in the test workers.
    execArgv: ["--no-webstorage"],
    // Only this checkout's tests. Git worktrees created by agent tooling live
    // under `.claude/worktrees/*` (gitignored) and carry their own copy of the
    // suite - without this, a local `pnpm test` runs every worktree's
    // in-progress tests against this checkout's node_modules and fails for
    // reasons that have nothing to do with the code under test.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"],
  },
});
