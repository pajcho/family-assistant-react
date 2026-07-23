import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { ListForm, type ListFormMode, type ListFormPayload } from "@/components/lists/ListForm";
import type { List } from "@/types/database";

export type ListFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: List | null;
  /**
   * Optional intent. Defaults to inferring "edit" when a `list` is passed
   * and "create" otherwise - so existing call sites (dashboard add, detail
   * edit) keep working untouched. Pass "duplicate" explicitly to pre-fill
   * from a list while still creating a new one.
   */
  mode?: ListFormMode;
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: ListFormPayload) => void;
};

export function ListFormDialog({
  open,
  onOpenChange,
  list,
  mode,
  error,
  saving,
  onSubmit,
}: ListFormDialogProps) {
  const resolvedMode: ListFormMode = mode ?? (list ? "edit" : "create");
  const title =
    resolvedMode === "edit"
      ? "Izmeni listu"
      : resolvedMode === "duplicate"
        ? "Dupliraj listu"
        : "Dodaj listu";

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
          mode={resolvedMode}
          saving={saving}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
