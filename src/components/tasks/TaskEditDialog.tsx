import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Textarea } from "@/components/ui/textarea";
import { TaskAllFields } from "@/components/tasks/TaskFields";
import { taskDraftToUpdateInput, taskToDraft } from "@/components/tasks/taskDraft";
import { useTaskAssignees } from "@/hooks/useTaskAssignees";
import type { UpdateTaskInput } from "@/hooks/useTasks";
import type { Task } from "@/types/database";

export type TaskEditPayload = UpdateTaskInput;

/**
 * Editing a task, in full: the name and note, plus every dimension the composer
 * hides behind its chips - rok and time, za koga, ponavljanje, podsetnik.
 *
 * It used to be the name/note pair only, on the theory that a shopping list
 * must not grow six fields to fix a typo in "Mleko". The theory was wrong in
 * the other direction: a task that HAS a date and a repeat rule had nowhere to
 * change them, so the only way to fix a wrong weekday was to delete the chore
 * and type it again.
 *
 * There is no Obriši here. Deleting is not a variation of editing - it lives on
 * the detail sheet's action list (and on a row's swipe), where a recurring task
 * gets asked the question this form cannot ask: this occurrence, or the series?
 */

/* ------------------------------------------------------------------------- */
/* The form                                                                   */
/* ------------------------------------------------------------------------- */

export type TaskEditFormProps = {
  task: Task;
  /**
   * Id for the `<form>`, so a Sačuvaj button OUTSIDE it (a sheet footer, a
   * sticky bar) can submit through the `form` attribute.
   */
  formId: string;
  onSubmit: (payload: TaskEditPayload) => void;
};

/**
 * The fields alone, without any chrome - one host wraps it in a dialog, another
 * pushes it onto a sheet stack, and both put their own buttons underneath.
 */
export function TaskEditForm({ task, formId, onSubmit }: TaskEditFormProps) {
  const { byTask } = useTaskAssignees();
  // Seeded once per mounted task. Every host remounts this on a new subject
  // (the dialog is unmounted between opens, the sheet re-keys its stack), so no
  // sync effect has to chase the row.
  const [draft, setDraft] = useState(() => taskToDraft(task, byTask.get(task.id) ?? []));
  const [description, setDescription] = useState<string>(task.description ?? "");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    const note = description.trim();
    onSubmit(taskDraftToUpdateInput(draft, note === "" ? null : note, task.list_id));
  };

  return (
    <form id={formId} className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor={`${formId}-name`}>Naziv *</Label>
        {/* No autoFocus - it would pop the iOS keyboard before the sheet has
            finished sliding in. */}
        <Input
          id={`${formId}-name`}
          value={draft.name}
          onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${formId}-description`}>Opis (opciono)</Label>
        <Textarea
          id={`${formId}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Dodatne informacije, Markdown podržan…"
          rows={3}
        />
      </div>

      {/* A listed task's own `scope` mirrors its list's - the trigger keeps them
          equal - so it doubles as the list's scope here, no extra query. */}
      <TaskAllFields
        draft={draft}
        setDraft={setDraft}
        listScope={task.list_id ? task.scope : null}
      />
    </form>
  );
}

/* ------------------------------------------------------------------------- */
/* The standalone dialog                                                      */
/* ------------------------------------------------------------------------- */

export type TaskEditDialogProps = {
  /** When non-null, the dialog is open and renders this task's editor. */
  item: Task | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (item: Task, payload: TaskEditPayload) => void;
  saving?: boolean;
};

/**
 * The editor as its own modal - what a row's text opens inside a list, where
 * there is no detail sheet to stack it onto.
 */
export function TaskEditDialog({
  item,
  onOpenChange,
  onSubmit,
  saving = false,
}: TaskEditDialogProps) {
  return (
    <ResponsiveDialog open={item !== null} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        stickyFooter={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Odustani
            </Button>
            <Button type="submit" form="task-edit" disabled={saving}>
              Sačuvaj
            </Button>
          </div>
        }
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Izmeni zadatak</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {item ? (
          <TaskEditForm task={item} formId="task-edit" onSubmit={(p) => onSubmit(item, p)} />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
