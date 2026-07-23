import { useEffect, useState } from "react";
import type { ComponentType, FormEvent, SVGProps } from "react";
import { UserGroupIcon, UserIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { List, ListScope } from "@/types/database";

export type ListFormPayload = {
  name: string;
  scope: ListScope;
  /** Hours of retention for completed items; null = never auto-delete. */
  auto_delete_completed_after_hours: number | null;
  /** Optional free-text description, Markdown supported. Empty string normalised to null. */
  description: string | null;
  /**
   * Duplicate mode only: also clone the source list's items into the new
   * list (as not-completed). Undefined in create/edit mode.
   */
  copyItems?: boolean;
};

/**
 * Which intent the form serves. We can't infer "duplicate" from the
 * presence of `list` (a duplicate is pre-filled *from* an existing list
 * yet still creates a brand-new row), so the caller states it explicitly.
 * It only drives the submit-button label and dialog title - the actual
 * create-vs-update decision lives in the page that owns the mutation.
 */
export type ListFormMode = "create" | "edit" | "duplicate";

export type ListFormProps = {
  list?: List | null;
  /** Defaults to "create". See {@link ListFormMode}. */
  mode?: ListFormMode;
  /** Create mode only - pre-fills the name (starter-chip "+ Šoping"). */
  initialName?: string;
  saving?: boolean;
  onSubmit: (payload: ListFormPayload) => void;
  onCancel: () => void;
};

type FormState = {
  name: string;
  scope: ListScope;
  /** Stored as string for the controlled <select>; serialised at submit. */
  autoDelete: string;
  description: string;
  /** "Kopiraj i stavke" - only shown (and submitted) in duplicate mode. */
  copyItems: boolean;
};

/**
 * Retention options offered in the form. Keep this matched with the
 * <option> values below - the empty string represents NULL (never).
 */
const AUTO_DELETE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Nikad" },
  { value: "1", label: "Posle 1 sata" },
  { value: "6", label: "Posle 6 sati" },
  { value: "24", label: "Posle 1 dana" },
  { value: "72", label: "Posle 3 dana" },
  { value: "168", label: "Posle 1 nedelje" },
];

function initialState(list: List | null | undefined, initialName?: string): FormState {
  return {
    name: list?.name ?? initialName ?? "",
    scope: list?.scope ?? "family",
    autoDelete:
      list?.auto_delete_completed_after_hours != null
        ? String(list.auto_delete_completed_after_hours)
        : "",
    description: list?.description ?? "",
    // Default ON: the main duplicate use-case is a fresh copy of a template
    // shopping list, items included.
    copyItems: true,
  };
}

export function ListForm({
  list,
  mode = "create",
  initialName,
  saving = false,
  onSubmit,
  onCancel,
}: ListFormProps) {
  const [form, setForm] = useState<FormState>(() => initialState(list, initialName));

  useEffect(() => {
    setForm(initialState(list, initialName));
  }, [list, initialName]);

  const submitLabel =
    mode === "edit" ? "Sačuvaj izmene" : mode === "duplicate" ? "Dupliraj" : "Dodaj";

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const trimmedDescription = form.description.trim();
    onSubmit({
      name: form.name.trim(),
      scope: form.scope,
      auto_delete_completed_after_hours: form.autoDelete === "" ? null : Number(form.autoDelete),
      // Whitespace-only descriptions collapse to NULL so the preview row
      // doesn't render a blank line under the title.
      description: trimmedDescription === "" ? null : trimmedDescription,
      copyItems: mode === "duplicate" ? form.copyItems : undefined,
    });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="list-name">Naziv liste *</Label>
        {/* No `autoFocus` here - on iOS the keyboard pops up the
            instant the drawer slides in, before the user has even
            seen the form. They tap the field themselves when they
            want to type. Matches BirthdayForm / EventForm. */}
        <Input
          id="list-name"
          value={form.name}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          required
          placeholder="npr. Šoping, Lične obaveze"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="list-description">Opis (opciono)</Label>
        <Textarea
          id="list-description"
          value={form.description}
          onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
          placeholder="Kratak opis liste, Markdown podržan…"
          rows={3}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Možeš koristiti Markdown (npr. <code className="font-mono">**podebljano**</code>,
          <code className="font-mono"> - stavka</code>, linkovi).
        </p>
      </div>

      <div className="space-y-2">
        <Label>Pristup</Label>
        <div className="grid grid-cols-2 gap-2">
          <ScopeButton
            active={form.scope === "family"}
            icon={UserGroupIcon}
            title="Porodica"
            description="Vide svi članovi"
            onClick={() => setForm((s) => ({ ...s, scope: "family" }))}
          />
          <ScopeButton
            active={form.scope === "personal"}
            icon={UserIcon}
            title="Lično"
            description="Samo ti"
            onClick={() => setForm((s) => ({ ...s, scope: "personal" }))}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="list-auto-delete">Auto-brisanje završenih stavki</Label>
        {/* Native <select> keeps the component count small and gets us
            free OS-level pickers on mobile (a bottom drawer on iOS, a
            wheel on Android). The styling matches the <Input> primitive
            so it doesn't look out of place next to the name field.
            `text-base md:text-sm` is load-bearing on iOS: Safari auto-zooms
            any focused form control whose computed font-size is < 16px,
            and the zoom is especially jarring when transitioning from the
            name input (keyboard up) into the select. */}
        <select
          id="list-auto-delete"
          value={form.autoDelete}
          onChange={(e) => setForm((s) => ({ ...s, autoDelete: e.target.value }))}
          className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:border-input dark:bg-input/30"
        >
          {AUTO_DELETE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Korisno za duge liste poput šopinga - završene stavke same nestaju.
        </p>
      </div>

      {mode === "duplicate" ? (
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <input
              id="list-copy-items"
              type="checkbox"
              checked={form.copyItems}
              onChange={(e) => setForm((s) => ({ ...s, copyItems: e.target.checked }))}
              className="h-4 w-4 cursor-pointer rounded border-gray-300"
            />
            <label
              htmlFor="list-copy-items"
              className="cursor-pointer text-sm text-gray-700 dark:text-gray-200"
            >
              Kopiraj i stavke
            </label>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Stavke se kopiraju kao nezavršene - kao sveža lista iz šablona.
          </p>
        </div>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Odustani
        </Button>
        <Button type="submit" disabled={saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

type ScopeButtonProps = {
  active: boolean;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  onClick: () => void;
};

function ScopeButton({ active, icon: Icon, title, description, onClick }: ScopeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
        active
          ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/30"
          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600 dark:hover:bg-gray-700/50",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "h-5 w-5",
            active ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400",
          )}
        />
        <span
          className={cn(
            "text-sm font-medium",
            active ? "text-blue-900 dark:text-blue-100" : "text-gray-900 dark:text-gray-100",
          )}
        >
          {title}
        </span>
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400">{description}</span>
    </button>
  );
}
