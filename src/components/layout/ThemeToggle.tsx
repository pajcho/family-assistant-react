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
    <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
      <button
        type="button"
        className={cn(
          "rounded-md p-1.5 transition-colors",
          mode === "light"
            ? "bg-white text-amber-500 shadow-sm"
            : "text-muted-foreground hover:text-foreground",
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
            ? "bg-white text-blue-500 shadow-sm"
            : "text-muted-foreground hover:text-foreground",
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
            ? "bg-white text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
        aria-label="Automatska tema"
        onClick={() => setMode("auto")}
      >
        <ComputerDesktopIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
