import { BanknotesIcon, PlusIcon, QrCodeIcon } from "@heroicons/react/24/outline";

import { AddSheetMenu } from "@/components/common/AddSheetMenu";

/**
 * The budget page's "Dodaj" — the shared AddSheetMenu over the three ways
 * money data enters the budget: scanning first (the most common entry),
 * manual expense, income.
 */
export type BudgetAddMenuProps = {
  onScanReceipt: () => void;
  onAddExpense: () => void;
  onAddIncome: () => void;
};

export function BudgetAddMenu({ onScanReceipt, onAddExpense, onAddIncome }: BudgetAddMenuProps) {
  return (
    <AddSheetMenu
      items={[
        {
          key: "scan",
          label: "Skeniraj račun",
          icon: QrCodeIcon,
          iconClass: "text-violet-600 dark:text-violet-400",
          iconBgClass: "bg-violet-100 dark:bg-violet-900/40",
          onSelect: onScanReceipt,
        },
        {
          key: "expense",
          label: "Unesi trošak",
          icon: PlusIcon,
          iconClass: "text-emerald-600 dark:text-emerald-400",
          iconBgClass: "bg-emerald-100 dark:bg-emerald-900/40",
          onSelect: onAddExpense,
        },
        {
          key: "income",
          label: "Dodaj prihod",
          icon: BanknotesIcon,
          iconClass: "text-amber-600 dark:text-amber-400",
          iconBgClass: "bg-amber-100 dark:bg-amber-900/40",
          onSelect: onAddIncome,
        },
      ]}
    />
  );
}
