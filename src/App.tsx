import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router";
import { Shell } from "@/components/Shell";
import { MODULES } from "@/modules/registry";
import { TodayPage } from "@/pages/TodayPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { applyTheme, useSettings } from "@/store/settings";

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
  useThemeSync();
  return (
    <HashRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          {MODULES.map(({ id, path, page: Page }) => (
            <Route key={id} path={path} element={<Page />} />
          ))}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </HashRouter>
  );
}
