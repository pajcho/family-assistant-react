import { useEffect, useMemo, useState } from "react";
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, SVGProps } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightCircleIcon,
  BanknotesIcon,
  CakeIcon,
  CalendarIcon,
  ClipboardDocumentListIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  LinkedEntityEditor,
  type EditableEntityRef,
} from "@/components/payments/LinkedEntityEditor";
import { SEARCH_PAGES } from "@/components/search/searchPages";
import {
  MIN_SEARCH_CHARS,
  useGlobalSearch,
  type SearchResult,
  type SearchResultKind,
} from "@/hooks/useGlobalSearch";
import { cn } from "@/lib/cn";

/**
 * Global search palette - opened by ⌘/Ctrl+K or the header's magnifying-glass
 * button. A debounced term fans out to the family-scoped `ilike` queries in
 * `useGlobalSearch`; hits are grouped by type with the agenda's icons/colors.
 * A "Stranice" group matches page names (diacritic-insensitive, so
 * "rodjendani" finds Rođendani) and navigates; its pages are derived from the
 * nav's own section list, see {@link SEARCH_PAGES}. Entity hits (activity,
 * event, payment, birthday) open their EDIT dialog in place via
 * LinkedEntityEditor - no page change; only lists/list items (they ARE pages)
 * and Google-mirror events still navigate.
 */

const DEBOUNCE_MS = 250;

/** Lowercase + strip Serbian diacritics so "placanja" matches "Plaćanja". */
function normalizeTerm(s: string): string {
  return s
    .toLowerCase()
    .replaceAll("đ", "dj")
    .replaceAll("č", "c")
    .replaceAll("ć", "c")
    .replaceAll("š", "s")
    .replaceAll("ž", "z");
}

type GroupMeta = {
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconClass: string;
};

/** Display order of the result groups - pages first, then entity groups. */
const GROUP_ORDER: readonly SearchResultKind[] = [
  "page",
  "activity",
  "event",
  "external",
  "payment",
  "birthday",
  "list",
  "list_item",
];

const GROUP_META: Record<SearchResultKind, GroupMeta> = {
  page: {
    label: "Stranice",
    Icon: ArrowRightCircleIcon,
    iconClass: "text-muted-foreground",
  },
  activity: {
    label: "Aktivnosti",
    Icon: UserGroupIcon,
    iconClass: "text-accent-deep",
  },
  event: {
    label: "Događaji",
    Icon: CalendarIcon,
    iconClass: "text-info",
  },
  external: {
    label: "Google kalendar",
    Icon: GlobeAltIcon,
    iconClass: "text-info",
  },
  payment: {
    label: "Plaćanja",
    Icon: BanknotesIcon,
    iconClass: "text-warn",
  },
  birthday: {
    label: "Rođendani",
    Icon: CakeIcon,
    iconClass: "text-pos",
  },
  list: {
    label: "Liste",
    Icon: ClipboardDocumentListIcon,
    iconClass: "text-accent-deep",
  },
  list_item: {
    label: "Stavke u listama",
    Icon: ClipboardDocumentListIcon,
    iconClass: "text-accent-deep",
  },
};

export type GlobalSearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTerm(term), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [term]);

  // Fresh palette on every open.
  useEffect(() => {
    if (!open) {
      setTerm("");
      setDebouncedTerm("");
    }
  }, [open]);

  const { results, isSearching, enabled } = useGlobalSearch(debouncedTerm);

  // In-place edit for entity hits - mounted as a sibling of the palette so it
  // survives the palette closing.
  const [editTarget, setEditTarget] = useState<EditableEntityRef | null>(null);

  // Page matches - instant, diacritic-insensitive, same min length. Keyed by
  // section key, since Porodica and Podešavanja share a path.
  const pageResults = useMemo<SearchResult[]>(() => {
    const q = normalizeTerm(debouncedTerm.trim());
    if (q.length < MIN_SEARCH_CHARS) return [];
    return SEARCH_PAGES.filter((p) => normalizeTerm(p.label).includes(q)).map((p) => ({
      kind: "page" as const,
      id: p.id,
      title: p.label,
      subtitle: null,
    }));
  }, [debouncedTerm]);

  const allResults = useMemo(() => [...pageResults, ...results], [pageResults, results]);

  // Group in the canonical order, numbering the rows straight through - the
  // flat list drives the arrow-key highlight across group boundaries.
  const groups = useMemo(() => {
    let index = 0;
    return GROUP_ORDER.map((kind) => ({
      kind,
      items: allResults
        .filter((r) => r.kind === kind)
        .map((result) => ({ result, index: index++ })),
    })).filter((g) => g.items.length > 0);
  }, [allResults]);
  const flatResults = useMemo(
    () => groups.flatMap((g) => g.items.map((item) => item.result)),
    [groups],
  );
  const hasResults = flatResults.length > 0;

  // Keyboard highlight - reset to the top on every new result set, keep the
  // highlighted row scrolled into view while arrowing.
  const [highlight, setHighlight] = useState(0);
  useEffect(() => {
    setHighlight(0);
  }, [allResults]);
  useEffect(() => {
    document.getElementById(optionId(highlight))?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const select = (result: SearchResult) => {
    onOpenChange(false);
    switch (result.kind) {
      case "page": {
        // Direct page-name hit - the one case that still navigates by design.
        const page = SEARCH_PAGES.find((p) => p.id === result.id);
        // `search` carries Porodica's `?tab=family`; undefined for the rest.
        if (page) void navigate({ to: page.to, search: page.search });
        break;
      }
      case "list":
        // A list IS a page - deep-link to it.
        void navigate({ to: "/lists/$listId", params: { listId: result.id } });
        break;
      case "list_item":
        if (result.listId) {
          void navigate({ to: "/lists/$listId", params: { listId: result.listId } });
        }
        break;
      case "activity":
      case "event":
      case "payment":
      case "birthday":
        // Open the edit dialog right here - no redirect.
        setEditTarget({ kind: result.kind, id: result.id });
        break;
      case "external":
        // Mirrored Google events are read-only and have no page of their own -
        // they live in the agenda, which is Kalendar's default view.
        void navigate({ to: "/kalendar" });
        break;
    }
  };

  const showNoResults = enabled && !isSearching && !hasResults;

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (flatResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % flatResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + flatResults.length) % flatResults.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = flatResults[highlight] ?? flatResults[0];
      if (target) select(target);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="top-24 gap-0 overflow-hidden p-0 translate-y-0"
        >
          <DialogTitle className="sr-only">Pretraga</DialogTitle>
          <DialogDescription className="sr-only">
            Pretraži aktivnosti, događaje, plaćanja, rođendane i liste po nazivu.
          </DialogDescription>

          <div className="flex items-center gap-2 border-b border-border px-4">
            <MagnifyingGlassIcon className="size-5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Pretraži…"
              aria-label="Pretraga"
              aria-controls="global-search-results"
              aria-activedescendant={hasResults ? optionId(highlight) : undefined}
              className="h-12 w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
            />
            {isSearching ? (
              <span
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-accent"
              />
            ) : null}
          </div>

          <div
            id="global-search-results"
            role="listbox"
            aria-label="Rezultati pretrage"
            className="max-h-[60vh] overflow-y-auto p-2"
          >
            {!enabled ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {`Ukucaj bar ${MIN_SEARCH_CHARS} znaka za pretragu.`}
              </p>
            ) : showNoResults ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                Nema rezultata za „{debouncedTerm.trim()}".
              </p>
            ) : (
              groups.map((group) => {
                const { label } = GROUP_META[group.kind];
                return (
                  <div key={group.kind}>
                    <div
                      role="presentation"
                      className="px-2 pt-2 pb-1 text-xs font-normal tracking-wide text-muted-foreground uppercase"
                    >
                      {label}
                    </div>
                    {group.items.map(({ result, index }) => (
                      <SearchResultRow
                        key={`${result.kind}-${result.id}`}
                        result={result}
                        index={index}
                        highlighted={index === highlight}
                        onHover={() => setHighlight(index)}
                        onSelect={() => select(result)}
                      />
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      <LinkedEntityEditor target={editTarget} onClose={() => setEditTarget(null)} />
    </>
  );
}

/** DOM id for the flat result at `index` - aria-activedescendant target. */
function optionId(index: number): string {
  return `global-search-option-${index}`;
}

function SearchResultRow({
  result,
  index,
  highlighted,
  onHover,
  onSelect,
}: {
  result: SearchResult;
  index: number;
  highlighted: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  const { Icon, iconClass } = GROUP_META[result.kind];
  // Page rows show the section's own nav icon instead of the group fallback.
  const page = result.kind === "page" ? SEARCH_PAGES.find((p) => p.id === result.id) : undefined;
  const RowIcon = page?.icon ?? Icon;
  return (
    <button
      type="button"
      id={optionId(index)}
      role="option"
      aria-selected={highlighted}
      tabIndex={-1}
      onClick={onSelect}
      // Highlight follows the pointer too, so mouse and arrows never fight
      // over two different "active" rows.
      onMouseEnter={onHover}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors",
        highlighted && "bg-muted",
      )}
    >
      <RowIcon className={cn("size-4 shrink-0", iconClass)} />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{result.title}</span>
      {result.subtitle ? (
        <span className="shrink-0 text-xs text-muted-foreground">{result.subtitle}</span>
      ) : null}
    </button>
  );
}
