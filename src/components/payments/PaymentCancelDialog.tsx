import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { Payment } from "@/types/database";
import { paymentCancelCopy } from "@/utils/payment";

/**
 * Confirm canceling (skipping) a payment occurrence, with an OPTIONAL reason.
 * The wording adapts to the payment type (one-time vs recurring) and, for
 * recurring payments, names the date the next occurrence comes due — see
 * `paymentCancelCopy`. Stored as a canceled history entry (recurring) or a
 * display-only override (one-time); restorable either way.
 */
export type PaymentCancelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Payment | null;
  saving?: boolean;
  onConfirm: (reason: string | null) => void;
};

export function PaymentCancelDialog({
  open,
  onOpenChange,
  payment,
  saving,
  onConfirm,
}: PaymentCancelDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open, payment?.id]);

  const copy = payment
    ? paymentCancelCopy(payment)
    : { title: "Otkaži ratu", message: "", placeholder: "" };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{copy.title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{copy.message}</p>
          <div className="space-y-2">
            <Label htmlFor="payment-cancel-reason">Razlog (opciono)</Label>
            <Textarea
              id="payment-cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={copy.placeholder}
              rows={3}
            />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Odustani
          </Button>
          <Button
            variant="destructive"
            disabled={saving}
            onClick={() => onConfirm(reason.trim() || null)}
          >
            {copy.title}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
