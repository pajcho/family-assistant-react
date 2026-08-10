import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { ListFormDialog } from "@/components/lists/ListFormDialog";
import type { ListFormPayload } from "@/components/lists/ListForm";
import { useCreateList } from "@/hooks/useTasks";

export type ListQuickAddFlowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * "Dodaj → Lista" on surfaces that aren't /lists. Same shape as
 * `ExpenseQuickAddFlow`: owns the mutation and the feedback but never
 * navigates, so the caller's page stays put whether the user saves or backs
 * out. The dashboard used to deep-link into `/lists?new=1` instead, which
 * dropped the user on another page the moment they opened - or closed - the
 * form.
 *
 * Lists aren't visible on the dashboard, so the success toast carries the way
 * in: one tap opens the freshly made list, and ignoring it keeps you where you
 * were.
 */
export function ListQuickAddFlow({ open, onOpenChange }: ListQuickAddFlowProps) {
  const navigate = useNavigate();
  const createList = useCreateList();
  const [formError, setFormError] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) setFormError(null);
  };

  const handleSubmit = async (payload: ListFormPayload) => {
    setFormError(null);
    try {
      const list = await createList.mutateAsync(payload);
      onOpenChange(false);
      toast.success("Lista je napravljena.", {
        action: {
          label: "Otvori",
          onClick: () => {
            void navigate({ to: "/lists/$listId", params: { listId: list.id } });
          },
        },
      });
    } catch (error) {
      setFormError(
        error instanceof Error && error.message ? error.message : "Greška pri kreiranju liste",
      );
    }
  };

  return (
    <ListFormDialog
      open={open}
      onOpenChange={handleOpenChange}
      list={null}
      mode="create"
      error={formError}
      saving={createList.isPending}
      onSubmit={(payload) => {
        void handleSubmit(payload);
      }}
    />
  );
}
