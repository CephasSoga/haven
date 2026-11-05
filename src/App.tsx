import { Suspense, useEffect, type ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { Shell } from "@/components/Shell";
import { ConfirmHost } from "@/components/confirm";
import { MODULES } from "@/modules/registry";
import { TodayPage } from "@/pages/TodayPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { applyTheme, useSettings } from "@/store/settings";
import { useMorningScheduler } from "@/modules/feed/scheduler";
import { useReminders } from "@/lib/notify";
import { useReleaseChecker } from "@/modules/releases/check";
import { UpdateBanner } from "@/components/UpdateBanner";
import { Notices } from "@/components/Notices";
import { RecordingPill } from "@/modules/meetings/RecordingPill";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { cloudEnabled, startAuth, useAuth } from "@/lib/cloud";
import { startSync, stopSync } from "@/lib/sync";
import { AuthScreen } from "@/pages/AuthScreen";

startAuth();

function useThemeSync() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
}

export function App() {
  return (
    <ErrorBoundary fullScreen>
      <Root />
    </ErrorBoundary>
  );
}

function Root() {
  useThemeSync();
  const status = useAuth((s) => s.status);
  const account = useAuth((s) => s.account);

  // Signed in: keep this device and the account in step.
  useEffect(() => {
    if (!cloudEnabled || status !== "signed-in" || !account) return;
    void startSync(account).then(() => {
      if (!useSettings.getState().name && account.name) useSettings.getState().set({ name: account.name });
    });
    return () => stopSync();
  }, [status, account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (cloudEnabled && status === "loading") return <Splash />;
  if (cloudEnabled && status === "signed-out")
    return (
      <>
        <AuthScreen />
        <ConfirmHost />
        <Notices />
      </>
    );
  return <Main />;
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <img src="/favicon.svg" alt="" className="size-14 animate-pulse rounded-2xl shadow-card" />
    </div>
  );
}

function Main() {
  useMorningScheduler();
  useReminders();
  useReleaseChecker();
  return (
    <HashRouter>
      <Shell>
        <PageBoundary>
        <Suspense fallback={<div className="h-[60dvh]" />}>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          {MODULES.map(({ id, path, page: Page }) => (
            <Route key={id} path={path} element={<Page />} />
          ))}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </PageBoundary>
      </Shell>
      <ConfirmHost />
      <UpdateBanner />
      <RecordingPill />
      <Notices />
    </HashRouter>
  );
}

/** A crash on one page leaves the menu working, and clears when you go to another page. */
function PageBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}
