import { ComputerDesktopIcon, MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import { cn } from "@/lib/cn";
import { useTheme } from "@/hooks/useTheme";

/**
 * Three-button theme selector (light / dark / auto), matching the layout and
 * styling of `components/ThemeToggle.vue` in the Nuxt source. Active button
 * gets a white pill background; auto resolves via `prefers-color-scheme`.
 */
export function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
      <button
        type="button"
        className={cn(
          "rounded-md p-1.5 transition-colors",
          mode === "light"
            ? "bg-white text-amber-500 shadow-sm dark:bg-gray-700"
            : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200",
        )}
        aria-label="Svetla tema"
        onClick={() => setMode("light")}
      >
        <SunIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn(
          "rounded-md p-1.5 transition-colors",
          mode === "dark"
            ? "bg-white text-blue-500 shadow-sm dark:bg-gray-700"
            : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200",
        )}
        aria-label="Tamna tema"
        onClick={() => setMode("dark")}
      >
        <MoonIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn(
          "rounded-md p-1.5 transition-colors",
          mode === "auto"
            ? "bg-white text-gray-700 shadow-sm dark:bg-gray-700 dark:text-gray-200"
            : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200",
        )}
        aria-label="Automatska tema"
        onClick={() => setMode("auto")}
      >
        <ComputerDesktopIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
