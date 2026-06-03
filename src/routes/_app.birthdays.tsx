import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { Birthday } from "@/types/database";
import { AddButton } from "@/components/common/AddButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { BirthdayListItem } from "@/components/birthdays/BirthdayListItem";
import {
  BirthdayFormDialog,
  type BirthdayFormDialogProps,
} from "@/components/birthdays/BirthdayFormDialog";
import { type BirthdayFormPayload } from "@/components/birthdays/BirthdayForm";
import {
  useBirthdaysList,
  useCreateBirthday,
  useUpdateBirthday,
  useDeleteBirthday,
} from "@/hooks/useBirthdays";
import { daysUntilBirthday } from "@/utils/birthday";

/**
 * `/birthdays` — list + CRUD for the family's birthdays.
 *
 * Direct port of `pages/birthdays/index.vue`. Data and realtime are owned by
 * the Phase 2C hooks; the sort by "days until next birthday" lives here
 * because the DB query orders by `birth_date` ASC (the order field is the
 * literal calendar date, not "next occurrence relative to today").
 */
export const Route = createFileRoute("/_app/birthdays")({
  component: BirthdaysPage,
});

function BirthdaysPage() {
  const { data: birthdays, isLoading } = useBirthdaysList();
  const createMutation = useCreateBirthday();
  const updateMutation = useUpdateBirthday();
  const deleteMutation = useDeleteBirthday();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBirthday, setEditingBirthday] = useState<Birthday | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [birthdayToDelete, setBirthdayToDelete] = useState<Birthday | null>(null);

  // Sort by next-occurrence so the soonest birthday is always on top, matching
  // the Vue page's `sortedBirthdays` computed.
  const sortedBirthdays = useMemo(() => {
    const list = birthdays ?? [];
    return [...list].sort(
      (a, b) => daysUntilBirthday(a.birth_date) - daysUntilBirthday(b.birth_date),
    );
  }, [birthdays]);

  const openAdd = () => {
    setEditingBirthday(null);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (birthday: Birthday) => {
    setEditingBirthday(birthday);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSubmit: BirthdayFormDialogProps["onSubmit"] = async (
    payload: BirthdayFormPayload,
  ) => {
    setFormError(null);
    try {
      if (editingBirthday) {
        await updateMutation.mutateAsync({ id: editingBirthday.id, payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      setDialogOpen(false);
      setEditingBirthday(null);
    } catch (err) {
      // The mutation hooks already toast on error; mirror the Vue page by
      // surfacing the message inline at the top of the dialog as well.
      const message =
        err instanceof Error
          ? err.message
          : editingBirthday
            ? "Greška pri ažuriranju rođendana"
            : "Greška pri kreiranju rođendana";
      setFormError(message);
    }
  };

  const handleDialogOpenChange = (next: boolean) => {
    setDialogOpen(next);
    if (!next) {
      setFormError(null);
      setEditingBirthday(null);
    }
  };

  const confirmDelete = (birthday: Birthday) => {
    setBirthdayToDelete(birthday);
    setDeleteDialogOpen(true);
  };

  const doDelete = async () => {
    if (!birthdayToDelete) return;
    try {
      await deleteMutation.mutateAsync(birthdayToDelete.id);
      setDeleteDialogOpen(false);
      setBirthdayToDelete(null);
    } catch {
      // Mutation hook already toasts; keep the dialog open so the user can retry.
    }
  };

  const handleDeleteOpenChange = (next: boolean) => {
    setDeleteDialogOpen(next);
    if (!next) setBirthdayToDelete(null);
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Rođendani</h1>
        <AddButton label="Dodaj rođendan" onClick={openAdd} />
      </div>

      {isLoading ? (
        <div className="mt-6 text-gray-500 dark:text-gray-400">Učitavanje…</div>
      ) : sortedBirthdays.length === 0 ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          Nema unetih rođendana.
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {sortedBirthdays.map((b) => (
            <li
              key={b.id}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
            >
              <BirthdayListItem birthday={b} onEdit={openEdit} onDelete={confirmDelete} />
            </li>
          ))}
        </ul>
      )}

      <BirthdayFormDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        birthday={editingBirthday}
        error={formError}
        saving={saving}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={handleDeleteOpenChange}
        title="Obriši rođendan"
        message={`Da li ste sigurni da želite da obrišete "${birthdayToDelete?.name ?? ""}"?`}
        loading={deleteMutation.isPending}
        onConfirm={doDelete}
      />
    </div>
  );
}
