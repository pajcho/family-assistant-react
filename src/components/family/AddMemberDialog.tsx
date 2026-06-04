import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useCreateFamilyMember } from "@/hooks/useFamilyMembers";
import { useCreateMemberLogin } from "@/hooks/useFamilyLogin";

export type AddMemberDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the new member's id so the parent can select it. */
  onCreated: (id: string) => void;
};

/**
 * Add a family member — login-less by default (a child), or with a login in one
 * step. The login path creates the profile first, then attaches an auth user
 * (which re-keys the profile id), so we hand back the *final* id to select.
 */
export function AddMemberDialog({ open, onOpenChange, onCreated }: AddMemberDialogProps) {
  const createMember = useCreateFamilyMember();
  const createLogin = useCreateMemberLogin();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [withLogin, setWithLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (open) {
      setFirstName("");
      setLastName("");
      setWithLogin(false);
      setEmail("");
      setPassword("");
    }
  }, [open]);

  const busy = createMember.isPending || createLogin.isPending;
  const nameValid = firstName.trim().length > 0 || lastName.trim().length > 0;
  const loginValid = !withLogin || (email.trim().length > 3 && password.length >= 6);
  const valid = nameValid && loginValid;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!valid) return;
    try {
      const profile = await createMember.mutateAsync({
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        color: null,
      });
      if (withLogin) {
        try {
          const newId = await createLogin.mutateAsync({ profileId: profile.id, email, password });
          toast.success("Član i nalog napravljeni.");
          onCreated(newId ?? profile.id);
        } catch {
          // The profile was created; only the login failed. Keep the member,
          // surface the (hook-toasted) error, and let the admin retry from the
          // member's detail pane.
          toast.error("Član je dodat, ali nalog nije napravljen. Pokušaj iz detalja člana.");
          onCreated(profile.id);
        }
      } else {
        toast.success("Član dodat.");
        onCreated(profile.id);
      }
      onOpenChange(false);
    } catch {
      // createMember error is toasted by the hook; keep the dialog open.
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Dodaj člana</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Novi član bez naloga služi da mu se dodeljuju aktivnosti i smene. Po želji mu odmah
            napravi i login.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-first-name">Ime</Label>
              <Input
                id="add-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="npr. Marko"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-last-name">Prezime</Label>
              <Input
                id="add-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="opciono"
              />
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
            <input
              id="add-with-login"
              type="checkbox"
              checked={withLogin}
              onChange={(e) => setWithLogin(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300"
            />
            <label htmlFor="add-with-login" className="min-w-0 cursor-pointer">
              <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                Napravi i nalog (login)
              </span>
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                Član će moći sam da se prijavi email-om i lozinkom.
              </span>
            </label>
          </div>

          {withLogin ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="add-email">Email</Label>
                <Input
                  id="add-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                  placeholder="ime@primer.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-password">Lozinka</Label>
                <Input
                  id="add-password"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  placeholder="bar 6 karaktera"
                />
              </div>
            </div>
          ) : null}

          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Odustani
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {busy ? "Čuva…" : "Dodaj"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
