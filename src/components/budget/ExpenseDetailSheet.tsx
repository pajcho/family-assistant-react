import { useEffect } from "react";
import { BanknotesIcon, PencilSquareIcon, TrashIcon } from "@heroicons/react/24/outline";

import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import { AuditTimeline } from "@/components/common/AuditTimeline";
import { DetailAuditLine } from "@/components/common/DetailAuditLine";
import {
  DetailActionList,
  DetailActionRow,
  DetailBadgeRow,
  DetailDeleteBody,
  DetailDeleteFooter,
  DetailHero,
  DetailInfoRow,
  DetailInfoRows,
  DetailInfoText,
  type DetailBadge,
} from "@/components/common/DetailSheet";
import { Amount, AmountOriginal } from "@/components/common/Amount";
import { MemberBadges } from "@/components/common/MemberBadges";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { useDeleteExpense } from "@/hooks/useExpenses";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import type { Expense } from "@/types/database";
import { formatDate } from "@/utils/date";
import { expenseLabels } from "@/utils/budget";

/**
 * THE expense detail popup - the sheet an expense never had.
 *
 * Every other money entity opened into the shared detail layout and a trošak
 * did not: tapping one jumped straight into the edit form, which is why it was
 * the one entity with nowhere to show who entered it or what changed
 * (plan 018). Now it reads like the rest - facts on top, actions as rows with
 * the primary FIRST and `Obriši` LAST, authorship as the quiet line at the
 * bottom.
 *
 * Only for expenses that ANSWER for themselves: hand-typed ones, and rows
 * orphaned by a deleted payment. A receipt-sourced expense belongs to its
 * receipt (`ReceiptExpenseDialog`) and a payment-sourced one to its payment,
 * and BudgetPage keeps routing those two where it always did - their facts live
 * somewhere else, and duplicating them here would give the same spend two
 * detail screens that disagree.
 */
export type ExpenseDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: Expense | null;
  /** Opens the full edit form; the sheet closes and hands off, as elsewhere. */
  onEdit: (expense: Expense) => void;
};

type View = "detail" | "delete" | "audit";

export function ExpenseDetailSheet({
  open,
  onOpenChange,
  expense,
  onEdit,
}: ExpenseDetailSheetProps) {
  const stack = useSheetStack<View>(open, onOpenChange, "detail");
  const { push, pop, reset } = stack;
  const deleteExpense = useDeleteExpense();
  const { byId: categoriesById } = useExpenseCategories();

  // Back to the root view whenever the subject expense changes underneath.
  useEffect(() => {
    reset();
  }, [expense, reset]);

  const category = expense?.category_id ? categoriesById.get(expense.category_id) : undefined;
  const { title, detail } = expense
    ? expenseLabels(expense, { categoryName: category?.name })
    : { title: "", detail: "" };
  const Icon = category ? categoryIcon(category.icon) : BanknotesIcon;
  const saving = deleteExpense.isPending;

  const handleEdit = () => {
    if (!expense) return;
    onOpenChange(false);
    onEdit(expense);
  };

  const handleDelete = async () => {
    if (!expense) return;
    try {
      await deleteExpense.mutateAsync(expense.id);
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook; stay here so the user can retry.
    }
  };

  const badges: DetailBadge[] = [];
  if (expense) {
    badges.push({ label: formatDate(expense.spent_on), tone: "neutral" });
    if (category) badges.push({ label: category.name, tone: "accent" });
    // A row left behind by a deleted payment looks hand-typed but is not, and
    // the difference explains why its numbers appeared without anyone typing.
    if (expense.source === "payment") {
      badges.push({ label: "Od plaćanja", tone: "info" });
    }
  }

  const titleFor = (view: View) =>
    view === "delete" ? "Obriši trošak" : view === "audit" ? "Istorija izmena" : "Detalji troška";

  return (
    <SheetStackViews
      stack={stack}
      render={(view, level) => (
        <ResponsiveDialogContent>
          <SheetStackHeader
            title={titleFor(view)}
            srOnly={level === 0}
            onBack={level === 0 ? undefined : pop}
          />
          {expense ? (
            <div className="space-y-4">
              {/* Root only: a stacked sub-view sits ON TOP of this sheet, which
                  already names the subject right above it. */}
              {level === 0 ? (
                <DetailHero
                  icon={Icon}
                  tone="accent"
                  iconWrapClassName={category ? undefined : "bg-accent-soft text-accent-deep"}
                  title={title}
                  subtitle={detail || "Trošak"}
                />
              ) : null}

              {view === "audit" ? (
                <AuditTimeline entityType="expenses" entityId={expense.id} />
              ) : view === "delete" ? (
                <DetailDeleteBody name={title} />
              ) : (
                <>
                  <DetailBadgeRow badges={badges} />

                  <DetailInfoRows>
                    <DetailInfoRow label="Iznos">
                      <span className="text-right font-semibold tabular-nums">
                        <Amount value={expense.amount} />
                        <AmountOriginal
                          amount={expense.original_amount}
                          currency={expense.currency}
                          className="block text-[11px] font-normal"
                        />
                      </span>
                    </DetailInfoRow>
                    <DetailInfoText label="Datum" value={formatDate(expense.spent_on)} />
                    {category ? <DetailInfoText label="Kategorija" value={category.name} /> : null}
                    {expense.person_id ? (
                      <DetailInfoRow label="Za koga">
                        <MemberBadges personIds={[expense.person_id]} size="xs" />
                      </DetailInfoRow>
                    ) : null}
                    {expense.merchant ? (
                      <DetailInfoText label="Prodavac" value={expense.merchant} />
                    ) : null}
                    {expense.note ? <DetailInfoText label="Beleška" value={expense.note} /> : null}
                  </DetailInfoRows>

                  <DetailActionList>
                    <DetailActionRow
                      icon={PencilSquareIcon}
                      tone="primary"
                      label="Izmeni trošak"
                      description="Iznos, kategorija, datum, beleška…"
                      onClick={handleEdit}
                      disabled={saving}
                    />
                    <DetailActionRow
                      icon={TrashIcon}
                      label="Obriši trošak"
                      description="Trajno uklanja trošak"
                      onClick={() => push("delete")}
                      disabled={saving}
                      tone="destructive"
                    />
                  </DetailActionList>

                  <DetailAuditLine row={expense} onOpenHistory={() => push("audit")} />
                </>
              )}
            </div>
          ) : null}

          {view === "delete" ? (
            <DetailDeleteFooter
              deleting={saving}
              onBack={pop}
              onConfirm={() => {
                void handleDelete();
              }}
            />
          ) : null}
        </ResponsiveDialogContent>
      )}
    />
  );
}
