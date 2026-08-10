import { useState } from "react";
import { toast } from "sonner";

import { BirthdayFormDialog } from "@/components/birthdays/BirthdayFormDialog";
import type { BirthdayFormPayload } from "@/components/birthdays/BirthdayForm";
import { useCreateBirthday } from "@/hooks/useBirthdays";

export type BirthdayQuickAddFlowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Add -> birthday from surfaces that don't own the birthdays mutations (the
 * global "+" in the bottom bar). Add only, owns its mutation and error, never
 * navigates - see `EventQuickAddFlow` for the shared shape.
 */
export function BirthdayQuickAddFlow({ open, onOpenChange }: BirthdayQuickAddFlowProps) {
  const createBirthday = useCreateBirthday();
  const [formError, setFormError] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) setFormError(null);
  };

  const handleSubmit = async (payload: BirthdayFormPayload) => {
    setFormError(null);
    try {
      await createBirthday.mutateAsync(payload);
      onOpenChange(false);
      // See `EventQuickAddFlow`: the flow stays put, so the toast is the only
      // confirmation the save happened.
      toast.success("Rođendan je dodat.");
    } catch (err) {
      setFormError(
        err instanceof Error && err.message ? err.message : "Greška pri kreiranju rođendana",
      );
    }
  };

  return (
    <BirthdayFormDialog
      open={open}
      onOpenChange={handleOpenChange}
      birthday={null}
      error={formError}
      saving={createBirthday.isPending}
      onSubmit={(payload) => {
        void handleSubmit(payload);
      }}
    />
  );
}
