import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Detects the current theme by watching for the `.dark` class on <html>.
 * Stays in sync with the app's ThemeProvider (which toggles that class).
 * Avoids a hard dep on next-themes so the app can ship its own provider.
 */
function useHtmlTheme(): "light" | "dark" {
  const getCurrent = (): "light" | "dark" =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";

  const [theme, setTheme] = useState<"light" | "dark">(getCurrent);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const update = () => {
      setTheme(html.classList.contains("dark") ? "dark" : "light");
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
    };
  }, []);

  return theme;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useHtmlTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
