import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <IosInstallHint />
      {/* On mobile the card chrome (border, bg, shadow, padding) is dropped
          so the form reads as the page itself - same content, edge-to-edge.
          On md+ the card framing is preserved for the desktop look. */}
      <Card className="w-full max-w-md max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:py-0 max-md:shadow-none">
        <CardHeader className="max-md:px-0">
          <CardTitle>Prijava</CardTitle>
          <CardDescription>Unesi email i lozinku za pristup.</CardDescription>
        </CardHeader>
        <CardContent className="max-md:px-0">
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@primer.rs"
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Lozinka</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Sakrij lozinku" : "Prikaži lozinku"}
                  aria-pressed={showPassword}
                  className="absolute top-1/2 right-1 inline-flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-4 w-4" />
                  ) : (
                    <EyeIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            {errorMessage ? (
              <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
            ) : null}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Prijavljivanje…" : "Prijavi se"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
