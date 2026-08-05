import { Suspense, useEffect, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { toast } from "sonner";
import { BanknotesIcon, QrCodeIcon, WalletIcon } from "@heroicons/react/24/outline";

import { ExpenseFormDialog } from "@/components/budget/ExpenseFormDialog";
import type { ExpenseFormPayload } from "@/components/budget/ExpenseForm";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import type { PaymentFormPayload } from "@/components/payments/PaymentForm";
import type { PaymentLinkValue } from "@/components/payments/PaymentLinkField";
import { useCreateExpense } from "@/hooks/useExpenses";
import { useCreatePayment } from "@/hooks/usePayments";
import { cn } from "@/lib/cn";

// Same lazy chunk as the budget page - camera + zxing stay out of the main bundle.
import { ReceiptScanDialog } from "@/components/budget/receipt/lazyReceiptScanDialog";

export type LinkedMoneyKind = "payment" | "expense" | "scan";

export type LinkedMoneyRequest = {
  kind: LinkedMoneyKind;
  /** What the new payment/expense gets linked to. Expense/scan requests must
   *  carry an activity or event link - expenses can't link birthdays. */
  link: PaymentLinkValue;
};

export type LinkedMoneyFlowProps = {
  /** What to add (and the link to pre-fill); null renders nothing. */
  request: LinkedMoneyRequest | null;
  /** Called when the flow is done (saved or dismissed). */
  onClose: () => void;
};

/**
 * The "dodaj uz..." money flows shared by the activity / event / birthday
 * detail dialogs - a new payment, a manual expense or a scanned receipt, each
 * opening pre-linked to the entity the member was just looking at. Mounted
 * OUTSIDE the hosting detail dialog, so the form survives that dialog closing.
 * Owns the mutations + inline errors, never navigates - the member stays where
 * they were after saving.
 *
 * `stage` mirrors `request.kind` but can diverge: the expense form's
 * "Skeniraj račun" shortcut hops to the scanner within the same request
 * (the link carries over).
 */
export function LinkedMoneyFlow({ request, onClose }: LinkedMoneyFlowProps) {
  const createPayment = useCreatePayment();
  const createExpense = useCreateExpense();
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [stage, setStage] = useState<LinkedMoneyKind | null>(request?.kind ?? null);

  // Each new request restarts the flow at its kind (and clears stale errors).
  useEffect(() => {
    setStage(request?.kind ?? null);
    setPaymentError(null);
    setExpenseError(null);
  }, [request]);

  if (!request || !stage) return null;

  const link = request.link;

  const handleDismiss = (open: boolean) => {
    if (!open) onClose();
  };

  const handlePaymentSubmit = async (payload: PaymentFormPayload) => {
    setPaymentError(null);
    try {
      await createPayment.mutateAsync(payload);
      onClose();
      toast.success("Plaćanje je dodato.");
    } catch (err) {
      setPaymentError(
        err instanceof Error && err.message ? err.message : "Greška pri dodavanju plaćanja",
      );
    }
  };

  const handleExpenseSubmit = async (payload: ExpenseFormPayload) => {
    setExpenseError(null);
    try {
      await createExpense.mutateAsync(payload);
      onClose();
      toast.success("Trošak je dodat.");
    } catch (err) {
      setExpenseError(
        err instanceof Error && err.message ? err.message : "Greška pri dodavanju troška",
      );
    }
  };

  return (
    <>
      {stage === "payment" ? (
        <PaymentFormDialog
          open
          onOpenChange={handleDismiss}
          payment={null}
          initialLink={link}
          error={paymentError}
          saving={createPayment.isPending}
          onSubmit={(payload) => {
            void handlePaymentSubmit(payload);
          }}
        />
      ) : null}

      {stage === "expense" ? (
        <ExpenseFormDialog
          open
          onOpenChange={handleDismiss}
          initialLink={link}
          error={expenseError}
          saving={createExpense.isPending}
          onSubmit={(payload) => {
            void handleExpenseSubmit(payload);
          }}
          onScanReceipt={() => setStage("scan")}
        />
      ) : null}

      {stage === "scan" ? (
        <Suspense fallback={null}>
          <ReceiptScanDialog open onOpenChange={handleDismiss} link={link} />
        </Suspense>
      ) : null}
    </>
  );
}

/**
 * The chooser rows for a "dodaj uz..." sub-view: what kind of money entry to
 * add. Pure UI - the host closes its sheet and mounts the request into
 * `LinkedMoneyFlow` on pick. Birthday hosts don't render this (payments are
 * their only linkable kind), so the rows always include the expense paths.
 */
export function LinkedMoneyChooser({ onPick }: { onPick: (kind: LinkedMoneyKind) => void }) {
  return (
    <div className="space-y-2">
      <ChooserRow
        icon={BanknotesIcon}
        label="Novo plaćanje"
        description="Jednokratno ili mesečno - članarina, oprema…"
        onClick={() => onPick("payment")}
      />
      <ChooserRow
        icon={WalletIcon}
        label="Novi trošak"
        description="Upiši već potrošeno pravo u budžet"
        onClick={() => onPick("expense")}
      />
      <ChooserRow
        icon={QrCodeIcon}
        label="Skeniraj račun"
        description="Uvezi fiskalni račun preko QR koda"
        onClick={() => onPick("scan")}
      />
    </div>
  );
}

function ChooserRow({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3 text-left",
        "transition-colors hover:bg-muted",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
      )}
    >
      <Icon className="size-[17px] shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </button>
  );
}
