import { useState } from "react";
import type { ReactNode } from "react";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { TaskEditDialog } from "@/components/tasks/TaskEditDialog";
import { useDeleteTask, useUpdateTask } from "@/hooks/useTasks";
import type { Task } from "@/types/database";

/**
 * "Izmeni" from a task detail sheet, on the screens that show tasks outside their
 * list (the /tasks overview and the smart lists).
 *
 * `TaskDetailSheet` closes itself and hands the task over, so this only has to
 * own the editor and the delete confirmation it can lead to. Without it the sheet
 * leaves "Izmeni" out entirely - which is correct behaviour on a surface that
 * cannot host a form, and not what we want on these.
 */
export interface UseTaskEditFlowResult {
  edit: (task: Task) => void;
  /** Mount once inside the calling screen. */
  dialog: ReactNode;
}

export function useTaskEditFlow(): UseTaskEditFlowResult {
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const [editing, setEditing] = useState<Task | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);

  const dialog = (
    <>
      <TaskEditDialog
        item={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSubmit={(task, payload) => {
          updateTask.mutate({ id: task.id, payload });
          setEditing(null);
        }}
        onDelete={(task) => {
          // Close the editor first so the confirmation can take focus over the
          // same spot instead of stacking behind it.
          setEditing(null);
          setPendingDelete(task);
        }}
        saving={updateTask.isPending}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Obriši zadatak"
        message={pendingDelete ? `Obrisati „${pendingDelete.name}"?` : ""}
        loading={deleteTask.isPending}
        onConfirm={() => {
          if (pendingDelete) deleteTask.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </>
  );

  return { edit: setEditing, dialog };
}
