import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

export type PaymentUndoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name of the payment whose last entry will be undone. */
  paymentName: string;
  loading?: boolean;
  onConfirm: () => void;
};

/**
 * Direct port of `components/payments/PaymentUndoDialog.vue`.
 *
 * Confirmation prompt invoked from a `history` row's "Poništi" action. Uses
 * the ResponsiveDialog so it lands as a bottom sheet on mobile and a centered
 * modal on desktop — matches the visual pattern in `.nuxt-screens/`.
 */
export function PaymentUndoDialog({
  open,
  onOpenChange,
  paymentName,
  loading = false,
  onConfirm,
}: PaymentUndoDialogProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Poništi plaćanje</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {`Da li ste sigurni da želite da poništite poslednje plaćanje za "${paymentName}"?`}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Ovo će obrisati zapis iz istorije i vratiti datum dospeća na prethodni mesec.
        </p>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose asChild>
            <Button variant="outline" disabled={loading}>
              Otkaži
            </Button>
          </ResponsiveDialogClose>
          <Button variant="destructive" disabled={loading} onClick={onConfirm}>
            Poništi
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
