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
import type { ListItem } from "@/types/database";

export type ListItemDialogPayload = {
  name: string;
  /** null when the textarea is empty after trimming whitespace. */
  description: string | null;
};

export type ListItemDialogProps = {
  /** When non-null, the dialog is open and renders this item's editor. */
  item: ListItem | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (item: ListItem, payload: ListItemDialogPayload) => void;
  onDelete: (item: ListItem) => void;
  saving?: boolean;
};

/**
 * View / edit popup for a single list item — replaces the old inline-edit
 * affordance on `ListItemRow`. Tapping any item row opens this dialog so
 * users can rename the item and add/edit a free-text description that
 * supports Markdown.
 *
 * Layout
 *   • Title field (`name`, required)
 *   • Description textarea (`description`, optional Markdown)
 *   • Live preview underneath the textarea when description is non-empty
 *   • Footer: Delete (left, destructive) + Cancel / Save (right)
 *
 * Wired with `ResponsiveDialog` so it renders as a centered modal on
 * desktop and as a bottom drawer on phones — same pattern as
 * `ListFormDialog`. The dialog is unmounted between opens so the form
 * state resets cleanly whenever the user picks a different item.
 */
export function ListItemDialog({
  item,
  onOpenChange,
  onSubmit,
  onDelete,
  saving = false,
}: ListItemDialogProps) {
  return (
    <ResponsiveDialog open={item !== null} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Detalji stavke</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {item ? (
          <ListItemDialogBody
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
  item: ListItem;
  onSubmit: (payload: ListItemDialogPayload) => void;
  onCancel: () => void;
  onDelete: () => void;
  saving: boolean;
};

function ListItemDialogBody({ item, onSubmit, onCancel, onDelete, saving }: BodyProps) {
  // Local form state initialised from the item. The parent rerenders the
  // dialog with a fresh `item` between opens, which remounts this body
  // (the parent's conditional `item ? <ListItemDialogBody> : null` is the
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
        <Label htmlFor="item-name">Naziv *</Label>
        {/* No autoFocus — same reasoning as the list form: avoids the iOS
            keyboard popping up before the drawer has finished sliding in. */}
        <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="item-description">Opis (opciono)</Label>
        <Textarea
          id="item-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Dodatne informacije, Markdown podržan…"
          rows={4}
        />
        {previewContent ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Pregled
            </p>
            <MarkdownText content={previewContent} />
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
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
