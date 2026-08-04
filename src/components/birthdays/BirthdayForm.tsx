import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Birthday } from "@/types/database";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/common/DateField";
import { FieldHint, FormInput } from "@/components/common/FormControls";
import { useToday } from "@/hooks/useToday";

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
  const today = useToday();

  const [name, setName] = useState<string>(birthday?.name ?? "");
  const [description, setDescription] = useState<string>(birthday?.description ?? "");
  const [birthDate, setBirthDate] = useState<string | null>(birthday?.birth_date ?? null);

  // Sync local state when the parent swaps the birthday (e.g. closes the edit
  // dialog and re-opens for "add"). Resetting on `birthday?.id` keeps the
  // dependency stable across the create case (id stays undefined).
  useEffect(() => {
    setName(birthday?.name ?? "");
    setDescription(birthday?.description ?? "");
    setBirthDate(birthday?.birth_date ?? null);
  }, [birthday?.id, birthday?.name, birthday?.description, birthday?.birth_date]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
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
    <form className="space-y-3" onSubmit={handleSubmit}>
      <FormInput
        id="birthday-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        placeholder="Ime - npr. Ana Petrović *"
        aria-label="Ime"
      />
      <FormInput
        id="birthday-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Opis (odnos) - npr. Kolega sa posla"
        aria-label="Opis"
      />
      {/* `dob` mode opens on the YEAR grid and offers direct entry
          ("15.05.1985") - three taps instead of paging decades of months. */}
      <DateField
        id="birthday-birth_date"
        label="Datum rođenja *"
        mode="dob"
        value={birthDate}
        onChange={setBirthDate}
        placeholder="Datum rođenja"
        maxDate={today.str}
      />
      <FieldHint>
        Godišnjice se računaju same, uz podsetnik na vreme. Proslavu kasnije organizuješ jednim
        tapom iz detalja.
      </FieldHint>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Odustani
        </Button>
        <Button type="submit" disabled={saving || !name.trim() || !birthDate}>
          {isEdit ? "Sačuvaj izmene" : "Dodaj"}
        </Button>
      </div>
    </form>
  );
}
