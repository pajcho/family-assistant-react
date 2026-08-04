import type { ComponentType, SVGProps } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/cn";

/**
 * Single nav item, used by both the mobile bottom bar (icon above a small
 * label) and the desktop inline row (icon beside the label, from `lg`).
 *
 * Active state is the accent itself, not a filled pill: the redesigned bar is
 * a quiet strip and a highlighted background would fight the elevated "+".
 */

interface AppNavLinkProps {
  to: string;
  /** Search params for sections that live under another route (Porodica). */
  search?: Record<string, string>;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  className?: string;
}

export function AppNavLink({ to, search, label, icon: Icon, className }: AppNavLinkProps) {
  return (
    <Link
      to={to}
      search={search}
      activeOptions={{ exact: to === "/" }}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-extrabold transition-colors lg:flex-row lg:gap-2 lg:px-2.5 lg:py-1.5 lg:text-sm lg:font-medium",
        className,
      )}
      activeProps={{ className: "text-accent-deep lg:bg-accent-soft" }}
      inactiveProps={{ className: "text-muted-foreground lg:hover:bg-muted" }}
    >
      <Icon className="size-[21px] shrink-0 lg:size-5" />
      <span>{label}</span>
    </Link>
  );
}
