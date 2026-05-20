import type { ComponentType, SVGProps } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/cn";

/**
 * Single nav item. Stacks icon-above-label on mobile (`flex-col`),
 * inline icon+label on `md:` and up (`flex-row`). Active state = gray pill.
 * The breakpoint matches AppNav's mobile/desktop flip (768px) so the bottom
 * tab bar's row layout and the top inline nav switch at the same width.
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
        "flex flex-col items-center gap-0.5 rounded-md px-3 py-2 text-sm font-medium transition-colors md:flex-row md:gap-2 md:px-2 md:py-1.5",
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
