import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { ListFormDialog } from "@/components/tasks/ListFormDialog";
import type { ListFormPayload } from "@/components/tasks/ListForm";
import { useCreateList } from "@/hooks/useTasks";

/**
 * "Make a new list", shared by the two surfaces that offer it: the dashed tile
 * at the end of the /tasks grid and the last row of the desktop sidebar.
 *
 * It also consumes the `?new=1` deep-link (the dashboard's "Dodaj → Lista"
 * entry) and strips the param afterwards, so the dialog cannot reopen on a
 * re-render or a back navigation - the same pattern `?edit=` uses on
 * /activities. The param lives on the layout route, so whichever surface is
 * mounted for the current breakpoint answers it.
 */
export interface UseCreateListFlowResult {
  openAdd: () => void;
  /** Starter-chip variant - opens with the name pre-filled. */
  openAddWithName: (name: string) => void;
  /** Mount this once inside the calling surface. */
  dialog: ReactNode;
}

export function useCreateListFlow(): UseCreateListFlowResult {
  const createList = useCreateList();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialName, setInitialName] = useState<string | null>(null);

  const { new: openNew } = useSearch({ from: "/_app/tasks" });
  const navigate = useNavigate();

  useEffect(() => {
    if (!openNew) return;
    setError(null);
    setInitialName(null);
    setOpen(true);
    // `to: "."` keeps the strip on the current URL even if the desktop index has
    // already redirected to /tasks/$listId.
    void navigate({ to: ".", search: (prev) => ({ ...prev, new: undefined }), replace: true });
  }, [openNew, navigate]);

  const openAdd = () => {
    setError(null);
    setInitialName(null);
    setOpen(true);
  };

  const openAddWithName = (name: string) => {
    setError(null);
    setInitialName(name);
    setOpen(true);
  };

  const submit = async (payload: ListFormPayload) => {
    setError(null);
    try {
      await createList.mutateAsync(payload);
      setOpen(false);
      setInitialName(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Greška pri kreiranju liste");
    }
  };

  const dialog = (
    <ListFormDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setInitialName(null);
        }
      }}
      list={null}
      mode="create"
      initialName={initialName ?? undefined}
      error={error}
      saving={createList.isPending}
      onSubmit={(payload) => {
        void submit(payload);
      }}
    />
  );

  return { openAdd, openAddWithName, dialog };
}
