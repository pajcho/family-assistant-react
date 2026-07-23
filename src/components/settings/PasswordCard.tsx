import { useState } from "react";
import type { ComponentProps, FormEvent } from "react";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { createSessionlessClient, supabase } from "@/lib/supabase";

/**
 * Matches what `manage-family-login` enforces when an admin creates a member's
 * login, so a password accepted there can't be rejected here (or vice versa).
 * If the project ever raises its minimum server-side, GoTrue's own message is
 * relayed verbatim below.
 */
const MIN_LENGTH = 6;

/**
 * Self-service password change for the signed-in member.
 *
 * The current password is verified first — `supabase.auth.updateUser({ password })`
 * alone would let anyone with a borrowed unlocked phone lock the owner out of
 * their own account. Verification runs on a sessionless client so the live
 * session (and every query keyed off it) is untouched whether it passes or fails.
 */
export function PasswordCard() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const filled = current.length > 0 && next.length > 0 && confirm.length > 0;

  // Any edit invalidates the message that was about the previous input.
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setError("");
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = user?.email;
    if (!email) {
      setError("Nalog nema email adresu, pa lozinka ne može da se promeni ovde.");
      return;
    }
    if (next.length < MIN_LENGTH) {
      setError(`Nova lozinka mora imati bar ${MIN_LENGTH} karaktera.`);
      return;
    }
    if (next !== confirm) {
      setError("Nova lozinka i potvrda se ne poklapaju.");
      return;
    }
    if (next === current) {
      setError("Nova lozinka mora biti različita od trenutne.");
      return;
    }

    setSaving(true);
    setError("");

    const verifier = createSessionlessClient();
    const { error: signInError } = await verifier.auth.signInWithPassword({
      email,
      password: current,
    });
    if (signInError) {
      setSaving(false);
      // 400 / invalid_credentials is the "wrong password" case; anything else
      // (rate limit, network, outage) keeps GoTrue's own wording so we don't
      // blame the user for a problem that isn't theirs.
      const wrongPassword =
        signInError.code === "invalid_credentials" || signInError.status === 400;
      setError(wrongPassword ? "Trenutna lozinka nije tačna." : signInError.message);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: next });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }

    setCurrent("");
    setNext("");
    setConfirm("");
    toast.success("Lozinka je promenjena.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lozinka</CardTitle>
        <CardDescription>
          Promena važi odmah. Ostaješ prijavljen/a na ovom uređaju — na ostalima će možda tražiti
          novu prijavu.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          {/* Hidden username field: password managers need the account it
              belongs to in order to offer the right entry for an update. */}
          <input type="hidden" autoComplete="username" value={user?.email ?? ""} readOnly />

          <PasswordField
            id="current-password"
            label="Trenutna lozinka"
            value={current}
            onValueChange={edit(setCurrent)}
            autoComplete="current-password"
            disabled={saving}
          />
          <PasswordField
            id="new-password"
            label="Nova lozinka"
            value={next}
            onValueChange={edit(setNext)}
            autoComplete="new-password"
            disabled={saving}
            hint={`Najmanje ${MIN_LENGTH} karaktera.`}
          />
          <PasswordField
            id="confirm-password"
            label="Potvrdi novu lozinku"
            value={confirm}
            onValueChange={edit(setConfirm)}
            autoComplete="new-password"
            disabled={saving}
          />

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !filled}>
              {saving ? "Menja…" : "Promeni lozinku"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface PasswordFieldProps extends Omit<
  ComponentProps<typeof Input>,
  "id" | "type" | "value" | "onChange"
> {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  hint?: string;
}

/** Label + masked input with the same reveal toggle as the login form. */
function PasswordField({ id, label, value, onValueChange, hint, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="••••••••"
          className="pr-10"
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Sakrij lozinku" : "Prikaži lozinku"}
          aria-pressed={visible}
          className="absolute top-1/2 right-1 inline-flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
        >
          {visible ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
        </button>
      </div>
      {hint ? <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p> : null}
    </div>
  );
}
