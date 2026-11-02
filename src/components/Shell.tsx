import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { Ellipsis, Settings, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MODULES } from "@/modules/registry";

type NavItem = { path: string; name: string; icon: LucideIcon; accent: string };

const NAV: NavItem[] = [
  { path: "/", name: "Today", icon: Sun, accent: "var(--ink)" },
  ...MODULES.map(({ path, name, icon, accent }) => ({ path, name, icon, accent })),
];
const SETTINGS: NavItem = { path: "/settings", name: "Settings", icon: Settings, accent: "var(--ink)" };

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-3">
      <img src="/favicon.svg" alt="" className="size-8 rounded-[10px] shadow-soft" />
      <span className="font-serif text-[26px] leading-none">Haven</span>
    </div>
  );
}

function SideLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const active = item.path === "/" ? pathname === "/" : pathname.startsWith(item.path);
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      className={cn(
        "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active ? "text-ink" : "text-muted hover:text-ink",
      )}
    >
      {active && (
        <motion.span
          layoutId="side-active"
          className="absolute inset-0 rounded-xl border border-line bg-surface shadow-soft"
          transition={{ type: "spring", bounce: 0.15, duration: 0.45 }}
        />
      )}
      <Icon className="relative size-[18px]" style={{ color: active ? item.accent : undefined }} />
      <span className="relative">{item.name}</span>
    </NavLink>
  );
}

function TabLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const active = item.path === "/" ? pathname === "/" : pathname.startsWith(item.path);
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      className={cn("relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium", active ? "text-ink" : "text-faint")}
    >
      {active && (
        <motion.span layoutId="tab-active" className="absolute inset-x-3 inset-y-1 rounded-2xl bg-sunken" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />
      )}
      <Icon className="relative size-5" style={{ color: active ? item.accent : undefined }} />
      <span className="relative">{item.name}</span>
    </NavLink>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  return (
    <div className="grain relative min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col gap-8 px-4 py-6 md:flex">
        <Logo />
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <SideLink key={item.path} item={item} />
          ))}
        </nav>
        <div className="mt-auto">
          <SideLink item={SETTINGS} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-canvas/80 px-4 py-3 backdrop-blur-xl md:hidden">
        <Logo />
      </div>

      <main className="relative z-10 md:pl-60">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto max-w-[1280px] px-4 pb-32 pt-6 sm:px-8 md:pb-12 md:pt-10"
        >
          {children}
        </motion.div>
      </main>

      <MobileNav />
    </div>
  );
}

/** Phones get the first four destinations as tabs; the rest live behind "More". */
function MobileNav() {
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);
  const tabs = NAV.slice(0, 4);
  const rest = [...NAV.slice(4), SETTINGS];
  const restActive = rest.some((i) => pathname.startsWith(i.path));
  useEffect(() => setMore(false), [pathname]);

  return (
    <>
      <AnimatePresence>
        {more && (
          <>
            <motion.div className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[2px] md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMore(false)} />
            <motion.div
              className="fixed inset-x-3 bottom-24 z-40 flex flex-col gap-1 rounded-3xl border border-line bg-surface p-2 shadow-float md:hidden"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
            >
              {rest.map((item) => (
                <SideLink key={item.path} item={item} />
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <nav className="fixed inset-x-3 bottom-3 z-40 flex rounded-3xl border border-line bg-surface/85 p-1 shadow-float backdrop-blur-xl md:hidden" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
        {tabs.map((item) => (
          <TabLink key={item.path} item={item} />
        ))}
        <button onClick={() => setMore(!more)} className={cn("relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium", more || restActive ? "text-ink" : "text-faint")}>
          {restActive && !more && <span className="absolute inset-x-3 inset-y-1 rounded-2xl bg-sunken" />}
          <Ellipsis className="relative size-5" />
          <span className="relative">More</span>
        </button>
      </nav>
    </>
  );
}
