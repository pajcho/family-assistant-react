import * as React from "react";
import { UserGroupIcon, UserIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import type { List, ListScope } from "@/types/database";

export type ListFormPayload = {
  name: string;
  scope: ListScope;
};

export type ListFormProps = {
  list?: List | null;
  saving?: boolean;
  onSubmit: (payload: ListFormPayload) => void;
  onCancel: () => void;
};

type FormState = {
  name: string;
  scope: ListScope;
};

function initialState(list: List | null | undefined): FormState {
  return {
    name: list?.name ?? "",
    scope: list?.scope ?? "family",
  };
}

export function ListForm({ list, saving = false, onSubmit, onCancel }: ListFormProps) {
  const [form, setForm] = React.useState<FormState>(() => initialState(list));

  React.useEffect(() => {
    setForm(initialState(list));
  }, [list]);

  const isEdit = !!list?.id;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({ name: form.name.trim(), scope: form.scope });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="list-name">Naziv liste *</Label>
        <Input
          id="list-name"
          value={form.name}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          required
          placeholder="npr. Šoping, Lične obaveze"
          autoFocus
        />
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
            description="Samo vi"
            onClick={() => setForm((s) => ({ ...s, scope: "personal" }))}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Otkaži
        </Button>
        <Button type="submit" disabled={saving}>
          {isEdit ? "Sačuvaj izmene" : "Dodaj"}
        </Button>
      </div>
    </form>
  );
}

type ScopeButtonProps = {
  active: boolean;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
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
