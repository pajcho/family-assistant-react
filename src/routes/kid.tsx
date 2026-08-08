import { useMemo } from "react";
import {
  Navigate,
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";

import { KidAccessRevokedScreen } from "@/components/kid/KidAccessRevokedScreen";
import { KidSessionBusyScreen } from "@/components/kid/KidSessionBusyScreen";
import { KidThemeScopeProvider, useKidThemeScope } from "@/components/kid/KidThemeScope";
import { useAuth } from "@/hooks/useAuth";
import { useFamilyChannel } from "@/hooks/useFamilyChannel";
import { useKidAccessCheck } from "@/hooks/useKidAccessCheck";
import { useKidInstallIdentity } from "@/hooks/useKidInstallIdentity";
import { findKidDevice, readKidDevices } from "@/hooks/useKidLogin";
import { useKidSession } from "@/hooks/useKidSession";
import { useApplyKidTheme, useKidTheme } from "@/hooks/useKidTheme";
import { useVisibilityRefetch } from "@/hooks/useVisibilityRefetch";
import { DEFAULT_KID_THEME } from "@/types/kid";

/**
 * Dečiji režim - the layout route for the whole kid shell.
 *
 * It is a SIBLING of the pathless `_app` layout, not a child of it, which is
 * the entire architectural point: it inherits ThemeProvider, QueryClient, Auth
 * and the Toaster from `__root`, and nothing else. No `AppSidebar`, no
 * `MobileBottomNav`, none of the grown-up app's chrome, and no way for the two
 * navigations to ever be on screen at once.
 *
 * Because they are siblings, exactly one of them is mounted at a time, so this
 * route can safely own `useFamilyChannel()` (the app's single realtime
 * subscription) and `useVisibilityRefetch()` - the same two hooks `_app` mounts
 * for grown-ups.
 *
 * Guards mirror `_app`'s `AuthGate` in the other direction: no session goes to
 * the kid login, a grown-up session goes back to the main app - with exactly
 * one exception, `/kid/pregled`, where a grown-up is deliberately looking at a
 * child's app from their own session.
 */
export const Route = createFileRoute("/kid")({
  component: KidLayout,
});

/** Routes that exist precisely because there is no session yet. */
function isPreSessionRoute(pathname: string): boolean {
  return pathname.startsWith("/kid/login") || pathname.startsWith("/kid/veza");
}

/** The device-link route. Singled out because its token is single use. */
function isLinkRoute(pathname: string): boolean {
  return pathname.startsWith("/kid/veza");
}

/** The one kid route a grown-up may open - and a child may not. */
function isPreviewRoute(pathname: string): boolean {
  return pathname.startsWith("/kid/pregled");
}

function KidLayout() {
  return (
    <KidThemeScopeProvider>
      <KidLayoutInner />
    </KidThemeScopeProvider>
  );
}

function KidLayoutInner() {
  const { session, loading } = useAuth();
  const { isKid, kidProfileId } = useKidSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { previewTheme } = useKidThemeScope();

  // Did a parent take this child's access away while they were using the app?
  // The hook asks the server (on mount, and whenever the app comes forward),
  // signs the child out on a definitive no, and leaves `revoked` behind so the
  // screens below can say WHICH no it was. It fails open on anything else.
  const { revoked, dismiss: dismissRevoked } = useKidAccessCheck();

  const preSession = isPreSessionRoute(pathname);
  const linkRoute = isLinkRoute(pathname);
  const previewRoute = isPreviewRoute(pathname);
  const inKidShell = pathname === "/kid" || pathname.startsWith("/kid/");

  // The theme this device last saw for THIS child (or, before there is a
  // session, whoever used it last). Reading it synchronously from localStorage
  // rather than waiting on the query is what stops the first frame after
  // sign-in flashing default-blue at a child who picked Svemir.
  //
  // Not in preview, though: a parent's device may have a child linked on it,
  // and painting THAT child's colours while previewing a different one is just
  // a lie. The preview announces the previewed child's theme through
  // `KidThemeScope` as soon as it knows it.
  const rememberedTheme = useMemo(
    () =>
      previewRoute
        ? DEFAULT_KID_THEME
        : ((kidProfileId ? findKidDevice(kidProfileId)?.theme : readKidDevices()[0]?.theme) ??
          DEFAULT_KID_THEME),
    [kidProfileId, previewRoute],
  );

  // Signed in: the stored theme wins. Signed out: whichever child the login
  // screen has selected, falling back to what this device remembers.
  const { theme: storedTheme } = useKidTheme(previewTheme ?? rememberedTheme);
  useApplyKidTheme(isKid ? storedTheme : (previewTheme ?? rememberedTheme));

  // What a home-screen install from here would be CALLED, and look like. Not on
  // the preview: a parent browsing their child's app is still holding their own
  // app, and must not walk away able to install a kid-branded copy of it.
  // Gated on `inKidShell` too, so the identity is handed back on the render
  // where the pathname leaves `/kid` rather than one render later, on unmount.
  useKidInstallIdentity(inKidShell && !previewRoute);

  // The app's single realtime channel + refetch-on-resume. Safe here for the
  // same reason `_app` is safe: only one of the two layouts is ever mounted.
  useVisibilityRefetch();
  useFamilyChannel();

  // Don't flash a redirect while `getSession()` is still in flight. A themed
  // panel rather than `null`, so the very first frame is already the child's.
  if (loading) return <KidSplash />;

  // On the way OUT of the kid shell this layout re-renders with the new
  // pathname a beat before it unmounts, so for one render every guard below is
  // being asked about a route that is no longer ours. Answering would override
  // a destination that was already chosen: "Izađi iz pregleda" navigated to
  // Podešavanja, this layout saw a non-preview path under a grown-up session,
  // and sent them to the dashboard instead. Nothing outside `/kid` is this
  // route's business.
  if (!inKidShell) return <KidSplash />;

  // Access ended mid-session. This has to come BEFORE the no-session redirect
  // below: the child was just signed out, so every guard after this point would
  // send them to the bare login screen - which is precisely the "app went blank
  // and nobody told me why" this screen exists to replace. Tapping through it
  // clears the verdict and lands on the login, by then with an explanation
  // already read.
  if (revoked) {
    return (
      <KidAccessRevokedScreen
        reason={revoked}
        onContinue={() => {
          dismissRevoked();
          void navigate({ to: "/kid/login", replace: true });
        }}
      />
    );
  }

  if (!session) {
    return preSession ? <Outlet /> : <Navigate to="/kid/login" replace />;
  }

  // Someone is signed in and is trying to reach a route that exists precisely
  // because nobody should be. EXPLAIN it, never redirect: the device-link token
  // rides in the URL fragment, and bouncing to the dashboard silently spends a
  // SINGLE-USE link while the parent watches their own app open instead. The
  // busy screen keeps the fragment in the address bar, so signing out from it
  // lands on the PIN step with the same link still good.
  //
  // `/kid/login` under a child's own session is the one case that stays a
  // redirect: nothing is at stake there, it is just a stale entry point, and a
  // child who taps an old bookmark should land in their app rather than be
  // asked a question about sessions.
  if (linkRoute || (preSession && !isKid)) return <KidSessionBusyScreen />;

  // A grown-up who somehow lands on /kid belongs in the main app - unless they
  // came to preview a child, which is the whole reason /kid/pregled exists.
  // The route itself still checks the child is theirs.
  if (!isKid) return previewRoute ? <Outlet /> : <Navigate to="/" replace />;

  // A signed-in child has no business on the login or preview screens.
  if (preSession || previewRoute) return <Navigate to="/kid" replace />;

  return <Outlet />;
}

/** The between-frames screen: the theme's gradient and nothing else. */
function KidSplash() {
  return (
    <div
      style={{ backgroundImage: "var(--k-grad)" }}
      className="kid-font grid h-[100dvh] w-full place-items-center text-white"
    >
      <p role="status" className="text-[15px] font-medium opacity-90">
        Samo trenutak...
      </p>
    </div>
  );
}
