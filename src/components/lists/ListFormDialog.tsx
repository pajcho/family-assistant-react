import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { ListForm, type ListFormPayload } from "@/components/lists/ListForm";
import type { List } from "@/types/database";

export type ListFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: List | null;
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: ListFormPayload) => void;
};

export function ListFormDialog({
  open,
  onOpenChange,
  list,
  error,
  saving,
  onSubmit,
}: ListFormDialogProps) {
  const title = list ? "Izmeni listu" : "Dodaj listu";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {error ? (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        ) : null}
        <ListForm
          list={list}
          saving={saving}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
