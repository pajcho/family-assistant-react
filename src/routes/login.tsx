import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EyeIcon, EyeSlashIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IosInstallHint } from "@/components/common/IosInstallHint";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { signIn, session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && session) {
      void navigate({ to: "/" });
    }
  }, [authLoading, session, navigate]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage("");
    setSubmitting(true);
    const { error } = await signIn(email, password);
    setSubmitting(false);
    if (error) {
      setErrorMessage(error.message || "Greška pri prijavi.");
      return;
    }
    await navigate({ to: "/" });
  }

  return (
    // The brand screen. Everything here stays BLUE regardless of the in-app
    // accent the user picked: this is the same identity as the PWA icon and
    // the splash, and it is shown before there is a profile to read a
    // preference from. The soft blue glows echo the prototype's login.
    <div className="relative flex h-[100dvh] flex-col overflow-y-auto bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(320px_220px_at_85%_-40px,var(--color-blue-100),transparent),radial-gradient(260px_200px_at_-60px_30%,var(--color-blue-100),transparent)] dark:bg-[radial-gradient(320px_220px_at_85%_-40px,var(--color-blue-950),transparent),radial-gradient(260px_200px_at_-60px_30%,var(--color-blue-950),transparent)]" />
      <IosInstallHint />
      <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-[calc(env(safe-area-inset-top)+3.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <div className="flex size-[74px] items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_14px_30px_-12px_var(--color-blue-600)]">
          <UserGroupIcon className="size-9" />
        </div>
        <h1 className="mt-4 text-[28px] leading-tight font-black tracking-tight">
          Porodični asistent
        </h1>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">
          Kalendar, plaćanja, budžet i liste -<br />
          sve što porodica deli, na jednom mestu.
        </p>

        <form className="mt-7 space-y-2.5" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="sr-only">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              autoComplete="email"
              className="h-12 bg-card text-base"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="sr-only">
              Lozinka
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Lozinka"
                required
                autoComplete="current-password"
                className="h-12 bg-card pr-11 text-base"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Sakrij lozinku" : "Prikaži lozinku"}
                aria-pressed={showPassword}
                className="absolute top-1/2 right-1.5 inline-flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? (
                  <EyeSlashIcon className="size-[18px]" />
                ) : (
                  <EyeIcon className="size-[18px]" />
                )}
              </button>
            </div>
          </div>
          {errorMessage ? <p className="text-sm font-semibold text-neg">{errorMessage}</p> : null}
          <Button
            type="submit"
            disabled={submitting}
            className="h-12 w-full bg-blue-600 text-base font-extrabold text-white hover:bg-blue-700"
          >
            {submitting ? "Prijavljivanje…" : "Prijavi se"}
          </Button>
        </form>

        <p className="mt-auto pt-10 text-center text-[11.5px] leading-relaxed font-semibold text-muted-foreground">
          Instaliraj kao aplikaciju: Podeli pa „Add to Home Screen".
        </p>
      </main>
    </div>
  );
}
