import {
  BanknotesIcon,
  CakeIcon,
  CalendarIcon,
  ClipboardDocumentListIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import { AddSheetMenu } from "@/components/common/AddSheetMenu";

/**
 * The dashboard's "Dodaj" — the shared AddSheetMenu over the four agenda
 * types plus a "Lista" shortcut (lists live on /lists, so that entry
 * navigates there with the create dialog open instead of opening a dialog in
 * place). Tile sheet on mobile, labelled header dropdown on desktop.
 */
export type AddMenuProps = {
  onAddActivity: () => void;
  onAddEvent: () => void;
  onAddPayment: () => void;
  onAddBirthday: () => void;
  onAddList: () => void;
};

export function AddMenu({
  onAddActivity,
  onAddEvent,
  onAddPayment,
  onAddBirthday,
  onAddList,
}: AddMenuProps) {
  return (
    <AddSheetMenu
      items={[
        {
          key: "activity",
          label: "Aktivnost",
          icon: UserGroupIcon,
          iconClass: "text-violet-600 dark:text-violet-400",
          iconBgClass: "bg-violet-100 dark:bg-violet-900/40",
          onSelect: onAddActivity,
        },
        {
          key: "event",
          label: "Događaj",
          icon: CalendarIcon,
          iconClass: "text-blue-600 dark:text-blue-400",
          iconBgClass: "bg-blue-100 dark:bg-blue-900/40",
          onSelect: onAddEvent,
        },
        {
          key: "payment",
          label: "Plaćanje",
          icon: BanknotesIcon,
          iconClass: "text-amber-600 dark:text-amber-400",
          iconBgClass: "bg-amber-100 dark:bg-amber-900/40",
          onSelect: onAddPayment,
        },
        {
          key: "birthday",
          label: "Rođendan",
          icon: CakeIcon,
          iconClass: "text-emerald-600 dark:text-emerald-400",
          iconBgClass: "bg-emerald-100 dark:bg-emerald-900/40",
          onSelect: onAddBirthday,
        },
        {
          key: "list",
          label: "Lista",
          icon: ClipboardDocumentListIcon,
          iconClass: "text-purple-600 dark:text-purple-400",
          iconBgClass: "bg-purple-100 dark:bg-purple-900/40",
          onSelect: onAddList,
        },
      ]}
    />
  );
}
