import type { ComponentType, SVGProps } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/cn";

/**
 * Single nav item. Stacks icon-above-label on mobile (`flex-col`),
 * inline icon+label on `sm:` and up (`flex-row`). Active state = gray pill.
 *
 * Direct port of `components/AppNavLink.vue` — Tailwind classes copied verbatim
 * so the mobile bottom-scroll nav and the desktop inline nav share the exact
 * same look as the Nuxt app.
 */

interface AppNavLinkProps {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  className?: string;
}

export function AppNavLink({ to, label, icon: Icon, className }: AppNavLinkProps) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:flex-row sm:gap-2 sm:px-2 sm:py-1.5",
        className,
      )}
      activeProps={{
        className: "bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-white",
      }}
      inactiveProps={{
        className:
          "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white",
      }}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}
