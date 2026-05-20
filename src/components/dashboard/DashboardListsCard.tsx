import { ClipboardDocumentListIcon } from "@heroicons/react/24/outline";
import { useNavigate } from "@tanstack/react-router";

import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { DashboardCardItem } from "@/components/dashboard/DashboardCardItem";
import type { ListWithItems } from "@/types/database";

export type DashboardListsCardProps = {
  lists: ListWithItems[];
  onAdd: () => void;
};

/**
 * Top-5 of lists with active/total item counts. Each row deep-links into
 * the per-list page (`/lists/$listId`) — the "I'm shopping, just give me
 * this one list" entry point. "Pogledaj sve" still routes to the overview.
 */
export function DashboardListsCard({ lists, onAdd }: DashboardListsCardProps) {
  const navigate = useNavigate();

  const visibleLists = lists.slice(0, 5);

  const goToList = (listId: string) => {
    void navigate({ to: "/lists/$listId", params: { listId } });
  };

  return (
    <DashboardCard
      icon={ClipboardDocumentListIcon}
      title="Liste"
      emptyMessage="Nema lista"
      addLabel="Dodaj listu"
      viewAllLink="/lists"
      hasItems={lists.length > 0}
      accent="purple"
      onAdd={onAdd}
    >
      {visibleLists.map((list) => {
        const active = list.list_items.filter((i) => !i.is_completed).length;
        const total = list.list_items.length;
        return (
          <DashboardCardItem
            key={list.id}
            label={list.name}
            description={list.scope === "personal" ? "Lično" : "Porodica"}
            value={total === 0 ? "0" : `${active}/${total}`}
            accent="purple"
            onClick={() => goToList(list.id)}
          />
        );
      })}
      {lists.length > 5 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">+ još {lists.length - 5}</p>
      ) : null}
    </DashboardCard>
  );
}
