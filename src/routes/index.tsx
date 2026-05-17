import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";

/**
 * Phase 0 placeholder. Phase 1A replaces this with the protected `_app`
 * layout + stub dashboard at `_app.index.tsx`, and the boot OK page goes away.
 */
export const Route = createFileRoute("/")({
  component: BootOk,
});

function BootOk() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  return (
    <div className="mx-auto max-w-2xl px-6 py-12 font-sans text-gray-900 dark:text-gray-100">
      <h1 className="text-2xl font-bold">boot OK</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Phase 0 scaffold for the Vite + React rewrite of family-assistant.
      </p>

      <dl className="mt-6 space-y-2 text-sm">
        <div>
          <dt className="font-semibold text-gray-700 dark:text-gray-300">VITE_SUPABASE_URL</dt>
          <dd className="break-all font-mono text-gray-900 dark:text-gray-100">{url}</dd>
        </div>
        <div>
          <dt className="font-semibold text-gray-700 dark:text-gray-300">Supabase client</dt>
          <dd className="font-mono text-gray-900 dark:text-gray-100">
            {supabase ? "initialised" : "failed to initialise"}
          </dd>
        </div>
      </dl>

      <p className="mt-8 text-xs text-gray-500">
        Next: Phase 1A wires AuthProvider + ThemeProvider + protected routes.
      </p>
    </div>
  );
}
