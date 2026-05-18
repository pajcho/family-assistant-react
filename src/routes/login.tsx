import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";

/**
 * Login page. Direct port of `pages/login.vue` (Serbian copy verbatim,
 * centered Card max-w-md, full-width primary button).
 *
 * Implemented with inline Tailwind elements (not shadcn primitives) because
 * Phase 1B owns `src/components/ui/*` and may not have committed by the
 * time Phase 1A ships. All Tailwind classes are copied verbatim from the
 * original Card / Input / Label / Button.vue components so the visual is
 * byte-equivalent. When Phase 1B lands its primitives, this file can be
 * trivially refactored to use them.
 */
export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { signIn, session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // If we land on /login while already authed (e.g. the user typed the URL
  // by hand), bounce them to the dashboard. Same intent as the Nuxt middleware.
  useEffect(() => {
    if (!authLoading && session) {
      void navigate({ to: "/" });
    }
  }, [authLoading, session, navigate]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
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
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-col space-y-1.5 p-6">
          <h1 className="text-2xl font-semibold leading-none tracking-tight text-gray-900 dark:text-white">
            Prijava
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Unesite email i lozinku za pristup.
          </p>
        </div>
        <div className="p-6 pt-0">
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-medium leading-none text-gray-700 dark:text-gray-200"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@ primer.rs"
                required
                autoComplete="email"
                className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-400 dark:focus:ring-offset-gray-900"
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-medium leading-none text-gray-700 dark:text-gray-200"
              >
                Lozinka
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-400 dark:focus:ring-offset-gray-900"
              />
            </div>
            {errorMessage ? (
              <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all duration-150 hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus-visible:ring-offset-gray-900"
            >
              Prijavi se
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
