import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { PasswordCard } from "@/components/settings/PasswordCard";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/lib/supabase";
import { readFunctionsError } from "@/utils/functionsError";
import { getDisplayName } from "@/utils/identity";

/**
 * "Lični podaci" - the settings sub-screen behind the profile card at the top
 * of the hub: name, email, and the password form. Lifted out of the old
 * `/settings` tab layout unchanged apart from the tokens.
 */
export function ProfileSection() {
  return (
    <>
      <ProfileCard />
      <PasswordCard />
    </>
  );
}

function ProfileCard() {
  const { user } = useAuth();
  const { profile, isLoading, updateProfile, isUpdating } = useProfile();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [emailChanging, setEmailChanging] = useState(false);

  // Resync the form whenever the upstream row updates (initial load,
  // post-save refetch, or another tab editing the same profile).
  useEffect(() => {
    setFirstName(profile?.first_name ?? "");
    setLastName(profile?.last_name ?? "");
  }, [profile?.first_name, profile?.last_name]);

  useEffect(() => {
    setEmail(user?.email ?? "");
  }, [user?.email]);

  const namesDirty =
    (profile?.first_name ?? "") !== firstName.trim() ||
    (profile?.last_name ?? "") !== lastName.trim();
  const emailDirty = (user?.email ?? "") !== email.trim();

  const submitProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (namesDirty) {
      await updateProfile({
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
      });
    }
    if (emailDirty) {
      setEmailChanging(true);
      // Custom Edge Function instead of `supabase.auth.updateUser({ email })`:
      // the standard call sends a confirmation link via Supabase's default
      // mailer (poor deliverability, often spam-filtered). The Edge Function
      // uses the service-role admin API to set the email directly. GoTrue
      // still validates uniqueness + format and we relay those errors.
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        error?: string;
      }>("update-user-email", {
        body: { email: email.trim() },
      });
      const errorMessage = error
        ? // FunctionsHttpError wraps non-2xx responses in a generic "Edge
          // Function returned a non-2xx status code" message and stashes
          // the actual response on `error.context`. Pull the real GoTrue
          // message (e.g. "email already in use") out of the body so we
          // can show it instead of the generic wrapper text.
          ((await readFunctionsError(error)) ?? error.message)
        : (data?.error ?? null);
      if (errorMessage) {
        toast.error(errorMessage);
        // Roll back the local value so the form reflects what Supabase still has.
        setEmail(user?.email ?? "");
        setEmailChanging(false);
        return;
      }
      // The JWT still carries the old email until the session refreshes -
      // force a refresh so `useAuth().user.email` reflects the new value
      // and the form's `emailDirty` flag resets without a reload.
      await supabase.auth.refreshSession();
      setEmailChanging(false);
      toast.success("Email izmenjen.");
    }
  };

  const identity = {
    firstName,
    lastName,
    email: user?.email ?? null,
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>Lični podaci</CardTitle>
        <CardDescription>
          Ime se prikazuje kroz aplikaciju, prezime samo u inicijalima. Email se može promeniti i
          primenjuje se odmah.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submitProfile} className="space-y-5">
          <div className="flex items-center gap-4">
            <UserAvatar {...identity} className="h-14 w-14 text-base" />
            <div className="min-w-0">
              {/* Previews what the app will actually show, which is the first
                  name - not the two fields concatenated. No email fallback:
                  the email already sits on the line below. */}
              <div className="truncate text-sm font-semibold">
                {getDisplayName({ ...identity, email: null }) || "Bez imena"}
              </div>
              <div className="truncate text-xs font-normal text-muted-foreground">
                {user?.email}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="first-name">Ime</Label>
              <Input
                id="first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={isLoading || isUpdating}
                autoComplete="given-name"
                placeholder="Vaše ime"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last-name">Prezime</Label>
              <Input
                id="last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={isLoading || isUpdating}
                autoComplete="family-name"
                placeholder="Vaše prezime"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={emailChanging}
              autoComplete="email"
              required
            />
            <p className="text-xs font-normal text-muted-foreground">
              Email se primenjuje odmah, bez dodatne potvrde.
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={isLoading || isUpdating || emailChanging || (!namesDirty && !emailDirty)}
            >
              {isUpdating || emailChanging ? "Čuva…" : "Sačuvaj"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
