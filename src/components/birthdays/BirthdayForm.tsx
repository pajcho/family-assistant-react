import * as React from "react";
import type { Birthday } from "@/types/database";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Controlled form for creating / editing a birthday. Direct port of
 * `components/birthdays/BirthdayForm.vue`.
 *
 * - Re-syncs form state when the `birthday` prop reference changes (open from
 *   "edit" then re-open from "add" must clear the fields).
 * - Trims string fields on submit; description normalizes to `null` when empty
 *   so the DB column stays nullable rather than holding empty strings.
 * - Submit is gated locally on `name` + `birth_date` to avoid emitting an
 *   incomplete payload; the underlying mutation hook also validates.
 */
export type BirthdayFormPayload = {
  name: string;
  description: string | null;
  birth_date: string;
};

export type BirthdayFormProps = {
  birthday?: Birthday | null;
  /** Disables submit + cancel while the parent mutation is in flight. */
  saving?: boolean;
  onSubmit: (payload: BirthdayFormPayload) => void;
  onCancel: () => void;
};

export function BirthdayForm({ birthday, saving = false, onSubmit, onCancel }: BirthdayFormProps) {
  const isEdit = !!birthday?.id;

  const [name, setName] = React.useState<string>(birthday?.name ?? "");
  const [description, setDescription] = React.useState<string>(birthday?.description ?? "");
  const [birthDate, setBirthDate] = React.useState<string | null>(birthday?.birth_date ?? null);

  // Sync local state when the parent swaps the birthday (e.g. closes the edit
  // dialog and re-opens for "add"). Resetting on `birthday?.id` keeps the
  // dependency stable across the create case (id stays undefined).
  React.useEffect(() => {
    setName(birthday?.name ?? "");
    setDescription(birthday?.description ?? "");
    setBirthDate(birthday?.birth_date ?? null);
  }, [birthday?.id, birthday?.name, birthday?.description, birthday?.birth_date]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName || !birthDate) return;
    onSubmit({
      name: trimmedName,
      description: trimmedDescription || null,
      birth_date: birthDate,
    });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="birthday-name">Ime *</Label>
        <Input
          id="birthday-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="npr. Ana Petrović"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="birthday-description">Opis (odnos)</Label>
        <Input
          id="birthday-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="npr. Kolega sa posla"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="birthday-birth_date">Datum rođenja *</Label>
        <DatePicker
          id="birthday-birth_date"
          value={birthDate}
          onChange={setBirthDate}
          placeholder="Datum rođenja"
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Otkaži
        </Button>
        <Button type="submit" disabled={saving || !name.trim() || !birthDate}>
          {isEdit ? "Sačuvaj izmene" : "Dodaj"}
        </Button>
      </div>
    </form>
  );
}
