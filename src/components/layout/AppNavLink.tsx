import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/cn";
import { isNavSectionActive, type NavSection } from "@/components/layout/navSections";

/**
 * Single nav item, used by both the mobile bottom bar (icon above a small
 * label) and the desktop inline row (icon beside the label, from `lg`).
 *
 * Active state is the accent itself, not a filled pill: the redesigned bar is
 * a quiet strip and a highlighted background would fight the elevated "+".
 *
 * The highlight comes from {@link isNavSectionActive} rather than the router's
 * own `activeProps`: family and settings share a pathname, and only the
 * `tab` search param says which of the two the location belongs to.
 */

interface AppNavLinkProps {
  section: NavSection;
  className?: string;
}

export function AppNavLink({ section, className }: AppNavLinkProps) {
  const { pathname, search } = useLocation();
  const active = isNavSectionActive(section, pathname, search);
  const Icon = section.icon;

  return (
    <Link
      to={section.to}
      search={section.search}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-bold transition-colors lg:flex-row lg:gap-2 lg:px-2.5 lg:py-1.5 lg:text-sm lg:font-medium",
        active ? "text-accent-deep lg:bg-accent-soft" : "text-muted-foreground lg:hover:bg-muted",
        className,
      )}
    >
      <Icon className="size-[21px] shrink-0 lg:size-5" />
      <span>{section.label}</span>
    </Link>
  );
}
