import { BanknotesIcon, PlusIcon, QrCodeIcon } from "@heroicons/react/24/outline";

import { AddSheetMenu } from "@/components/common/AddSheetMenu";
import { HeaderIconButton } from "@/components/money/moneyUi";

/**
 * The budget page's "Dodaj" - the shared AddSheetMenu over the three ways
 * money data enters the budget: scanning first (the most common entry),
 * manual expense, income.
 *
 * Rendered as an icon tile because it lives in the Novac header next to the
 * scanner and search buttons. Desktop only, like every page-level add
 * affordance since the redesign: below `lg` the bottom bar's "+" is the one
 * entry point for adding anything.
 */
export type BudgetAddMenuProps = {
  onScanReceipt: () => void;
  onAddExpense: () => void;
  onAddIncome: () => void;
};

export function BudgetAddMenu({ onScanReceipt, onAddExpense, onAddIncome }: BudgetAddMenuProps) {
  return (
    <AddSheetMenu
      trigger={<HeaderIconButton icon={PlusIcon} label="Dodaj" className="hidden lg:grid" />}
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
