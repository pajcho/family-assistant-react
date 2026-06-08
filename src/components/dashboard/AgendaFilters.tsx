import type { ComponentType, SVGProps } from "react";
import {
  BanknotesIcon,
  CakeIcon,
  CalendarIcon,
  FunnelIcon,
  GlobeAltIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { PersonChip } from "@/components/activities/PersonChip";
import { cn } from "@/lib/cn";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { AGENDA_KINDS, type AgendaFilter, type AgendaKind } from "@/utils/agendaFilters";

/**
 * Shared dashboard filter bar — item type + person — applied identically to the
 * Danas and Uskoro lists (and, later, the calendar). Matches the plan's
 * placement: visible chips inline on desktop (md+, there's room), a compact
 * "Filteri" button opening a bottom sheet on mobile.
 *
 * Both facets use the activities-page chip convention: an EMPTY selection shows
 * every chip as active (no filter); clicking narrows to the clicked items.
 * Person chips are the same `PersonChip` the /activities header uses.
 */
export type AgendaFiltersProps = {
  filter: AgendaFilter;
  toggleKind: (kind: AgendaKind) => void;
  togglePerson: (personId: string) => void;
  reset: () => void;
  isActive: boolean;
  count: number;
};

type KindMeta = {
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Tint applied when the chip is active. */
  activeClass: string;
  /** Accent kept on the icon in both states, for at-a-glance recognition. */
  iconClass: string;
};

const KIND_META: Record<AgendaKind, KindMeta> = {
  activity: {
    label: "Aktivnosti",
    Icon: UserGroupIcon,
    activeClass:
      "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300",
    iconClass: "text-violet-500 dark:text-violet-400",
  },
  event: {
    label: "Događaji",
    Icon: CalendarIcon,
    activeClass:
      "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300",
    iconClass: "text-blue-500 dark:text-blue-400",
  },
  external: {
    label: "Google",
    Icon: GlobeAltIcon,
    activeClass:
      "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300",
    iconClass: "text-sky-500 dark:text-sky-400",
  },
  payment: {
    label: "Plaćanja",
    Icon: BanknotesIcon,
    activeClass:
      "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
    iconClass: "text-amber-500 dark:text-amber-400",
  },
  birthday: {
    label: "Rođendani",
    Icon: CakeIcon,
    activeClass:
      "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
    iconClass: "text-emerald-500 dark:text-emerald-400",
  },
};

function TypeChip({
  kind,
  active,
  onToggle,
}: {
  kind: AgendaKind;
  active: boolean;
  onToggle: () => void;
}) {
  const { label, Icon, activeClass, iconClass } = KIND_META[kind];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        active
          ? activeClass
          : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
      )}
    >
      <Icon className={cn("size-4 shrink-0", iconClass)} />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function AgendaFilters({
  filter,
  toggleKind,
  togglePerson,
  reset,
  isActive,
  count,
}: AgendaFiltersProps) {
  const { members } = useFamilyMembers();

  // Empty set ⇒ every chip reads as active (no filter); otherwise only the
  // selected ones do.
  const kindActive = (kind: AgendaKind) => filter.kinds.size === 0 || filter.kinds.has(kind);
  const personActive = (id: string) => filter.personIds.size === 0 || filter.personIds.has(id);

  const renderTypeChips = () =>
    AGENDA_KINDS.map((kind) => (
      <TypeChip
        key={kind}
        kind={kind}
        active={kindActive(kind)}
        onToggle={() => toggleKind(kind)}
      />
    ));

  const renderPersonChips = () =>
    members.map((member) => (
      <PersonChip
        key={member.id}
        person={member}
        active={personActive(member.id)}
        onToggle={() => togglePerson(member.id)}
      />
    ));

  return (
    <>
      {/* Desktop: chips inline. */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {renderTypeChips()}
        {members.length > 0 ? (
          <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
        ) : null}
        {renderPersonChips()}
        {isActive ? (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
            Resetuj
          </Button>
        ) : null}
      </div>

      {/* Mobile: a compact trigger that opens a bottom sheet. */}
      <div className="md:hidden">
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline" size="sm">
              <FunnelIcon className="size-4" />
              Filteri
              {count > 0 ? (
                <span className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white tabular-nums">
                  {count}
                </span>
              ) : null}
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader className="flex flex-row items-center justify-between">
              <DrawerTitle>Filteri</DrawerTitle>
              {isActive ? (
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
                  Resetuj
                </Button>
              ) : null}
            </DrawerHeader>
            <div className="space-y-5 px-4 pb-8">
              <section className="space-y-2">
                <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Tip
                </h4>
                <div className="flex flex-wrap gap-2">{renderTypeChips()}</div>
              </section>
              {members.length > 0 ? (
                <section className="space-y-2">
                  <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Članovi
                  </h4>
                  <div className="flex flex-wrap gap-2">{renderPersonChips()}</div>
                </section>
              ) : null}
              <DrawerClose asChild>
                <Button className="w-full">Gotovo</Button>
              </DrawerClose>
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </>
  );
}
