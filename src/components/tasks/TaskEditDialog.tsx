import { useState } from "react";
import type { FormEvent } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownText } from "@/components/common/MarkdownText";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Textarea } from "@/components/ui/textarea";
import type { Task } from "@/types/database";

export type TaskEditPayload = {
  name: string;
  /** null when the textarea is empty after trimming whitespace. */
  description: string | null;
};

export type TaskEditDialogProps = {
  /** When non-null, the dialog is open and renders this task's editor. */
  item: Task | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (item: Task, payload: TaskEditPayload) => void;
  onDelete: (item: Task) => void;
  saving?: boolean;
};

/**
 * Rename / describe one task from inside its list - the quick editor a row's
 * text opens. It deliberately stays the NAME + NOTE pair it has always been:
 * dates, assignees, recurrence and reminders are the composer's and
 * `TaskDetailSheet`'s business, and a shopping list must not grow six fields to
 * fix a typo in "Mleko".
 *
 * Layout
 *   • Title field (`name`, required)
 *   • Description textarea (`description`, optional Markdown)
 *   • Live preview underneath the textarea when description is non-empty
 *   • Footer: Delete (left, destructive) + Odustani / Sačuvaj (right)
 *
 * Wired with `ResponsiveDialog` so it renders as a centered modal on
 * desktop and as a bottom drawer on phones - same pattern as
 * `ListFormDialog`. The dialog is unmounted between opens so the form
 * state resets cleanly whenever the user picks a different task.
 */
export function TaskEditDialog({
  item,
  onOpenChange,
  onSubmit,
  onDelete,
  saving = false,
}: TaskEditDialogProps) {
  return (
    <ResponsiveDialog open={item !== null} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Izmeni zadatak</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {item ? (
          <TaskEditDialogBody
            item={item}
            onSubmit={(payload) => onSubmit(item, payload)}
            onCancel={() => onOpenChange(false)}
            onDelete={() => onDelete(item)}
            saving={saving}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

type BodyProps = {
  item: Task;
  onSubmit: (payload: TaskEditPayload) => void;
  onCancel: () => void;
  onDelete: () => void;
  saving: boolean;
};

function TaskEditDialogBody({ item, onSubmit, onCancel, onDelete, saving }: BodyProps) {
  // Local form state initialised from the item. The parent rerenders the
  // dialog with a fresh `item` between opens, which remounts this body
  // (the parent's conditional `item ? <TaskEditDialogBody> : null` is the
  // remount boundary), so we don't need a manual sync effect.
  const [name, setName] = useState<string>(item.name);
  const [description, setDescription] = useState<string>(item.description ?? "");

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedDescription = description.trim();
    onSubmit({
      name: trimmedName,
      description: trimmedDescription === "" ? null : trimmedDescription,
    });
  };

  const previewContent = description.trim();

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="task-name">Naziv *</Label>
        {/* No autoFocus - same reasoning as the list form: avoids the iOS
            keyboard popping up before the drawer has finished sliding in. */}
        <Input id="task-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-description">Opis (opciono)</Label>
        <Textarea
          id="task-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Dodatne informacije, Markdown podržan…"
          rows={4}
        />
        {previewContent ? (
          <div className="rounded-md border border-border bg-muted p-3/40">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Pregled
            </p>
            <MarkdownText content={previewContent} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Možete koristiti Markdown (npr. <code className="font-mono">**podebljano**</code>,
            <code className="font-mono"> - tačke</code>, linkovi).
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={onDelete}
          disabled={saving}
          className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
        >
          <TrashIcon className="h-4 w-4" />
          Obriši
        </Button>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Odustani
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            Sačuvaj
          </Button>
        </div>
      </div>
    </form>
  );
}
