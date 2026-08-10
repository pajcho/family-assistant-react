import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { ResponsiveDialog, ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { FieldGroupLabel, FormInput } from "@/components/common/FormControls";
import { SheetStackHeader } from "@/components/common/SheetStack";
import { TaskAllFields } from "@/components/tasks/TaskFields";
import {
  emptyTaskDraft,
  taskDraftToCreateInput,
  type TaskDraft,
} from "@/components/tasks/taskDraft";
import { useCreateTask, useListsWithTasks } from "@/hooks/useTasks";

/**
 * "Dodaj → Zadatak" from anywhere - the same shape as `ExpenseQuickAddFlow`: it
 * owns the mutation and the feedback but never navigates, so the caller's page
 * stays put whether the user saves or backs out.
 *
 * Unlike the on-screen composer this sheet IS the form, so its fields live in it
 * rather than behind four more taps - what the composer keeps behind sub-views is
 * screen space it does not have. Only `Naziv` is required; a task with nothing
 * else set lands in the Inbox, which is exactly what the Inbox exists to catch.
 *
 * Tasks are not visible on most screens, so the success toast carries the way in:
 * one tap opens where it landed, and ignoring it leaves you where you were.
 */
export type TaskQuickAddFlowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const NO_LIST = "";

export function TaskQuickAddFlow({ open, onOpenChange }: TaskQuickAddFlowProps) {
  const navigate = useNavigate();
  const createTask = useCreateTask();
  const listsQuery = useListsWithTasks();

  const [draft, setDraft] = useState<TaskDraft>(() => emptyTaskDraft());
  const [listId, setListId] = useState<string>(NO_LIST);
  const [error, setError] = useState<string | null>(null);

  const listOptions = useMemo(
    () => [
      { value: NO_LIST, label: "Bez liste (Inbox)" },
      ...[...(listsQuery.data ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name, "sr"))
        .map((list) => ({ value: list.id, label: list.name })),
    ],
    [listsQuery.data],
  );

  const reset = () => {
    setDraft(emptyTaskDraft());
    setListId(NO_LIST);
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return;
    setError(null);
    const target = listId === NO_LIST ? null : listId;
    try {
      await createTask.mutateAsync(taskDraftToCreateInput({ ...draft, name }, target));
      onOpenChange(false);
      reset();
      toast.success("Zadatak je dodat.", {
        action: {
          label: "Otvori",
          onClick: () => {
            if (target) {
              void navigate({ to: "/tasks/$listId", params: { listId: target } });
              return;
            }
            void navigate({ to: "/tasks/inbox" });
          },
        },
      });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Greška pri dodavanju zadatka");
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent
        className="sm:max-w-md"
        stickyFooter={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Odustani
            </Button>
            <Button
              type="submit"
              form="task-quick-add"
              disabled={createTask.isPending || !draft.name.trim()}
            >
              Dodaj zadatak
            </Button>
          </div>
        }
      >
        <SheetStackHeader title="Novi zadatak" />
        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-lg bg-neg-soft p-3 text-sm font-normal text-neg"
          >
            {error}
          </div>
        ) : null}
        <form
          id="task-quick-add"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <div>
            <FieldGroupLabel>
              <label htmlFor="task-quick-name">Naziv *</label>
            </FieldGroupLabel>
            {/* No autoFocus - it would pop the iOS keyboard before the drawer has
                finished sliding in. */}
            <FormInput
              id="task-quick-name"
              value={draft.name}
              onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
              placeholder="npr. Zvati servis za kotao"
              required
            />
          </div>

          <div>
            <FieldGroupLabel>
              <label htmlFor="task-quick-list">Lista</label>
            </FieldGroupLabel>
            <NativeSelect
              id="task-quick-list"
              value={listId}
              onChange={setListId}
              options={listOptions}
              parse={(raw) => raw}
            />
          </div>

          <TaskAllFields draft={draft} setDraft={setDraft} />
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
