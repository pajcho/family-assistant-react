import { BanknotesIcon, PlusIcon, QrCodeIcon } from "@heroicons/react/24/outline";

import { AddSheetMenu } from "@/components/common/AddSheetMenu";

/**
 * The budget page's "Dodaj" - the shared AddSheetMenu over the three ways
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
          iconClass: "text-accent-deep",
          iconBgClass: "bg-accent-soft",
          onSelect: onScanReceipt,
        },
        {
          key: "expense",
          label: "Unesi trošak",
          icon: PlusIcon,
          iconClass: "text-pos",
          iconBgClass: "bg-pos-soft",
          onSelect: onAddExpense,
        },
        {
          key: "income",
          label: "Dodaj prihod",
          icon: BanknotesIcon,
          iconClass: "text-warn",
          iconBgClass: "bg-warn-soft",
          onSelect: onAddIncome,
        },
      ]}
    />
  );
}
