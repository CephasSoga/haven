import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Ellipsis, Settings, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { GROUPS, MODULES, type GroupId } from "@/modules/registry";

type NavItem = { path: string; name: string; icon: LucideIcon; accent: string; group?: GroupId };

const NAV: NavItem[] = [
  { path: "/", name: "Today", icon: Sun, accent: "var(--ink)" },
  ...MODULES.map(({ path, name, icon, accent, group }) => ({ path, name, icon, accent, group })),
];
/** Phone tabs; everything else lives behind "More". */
const TAB_PATHS = ["/", "/assistant", "/morning", "/calendar"];

const isActive = (item: NavItem, pathname: string) => (item.path === "/" ? pathname === "/" : pathname.startsWith(item.path));

/** Menu sections you folded away, remembered on this device. */
const FOLDED = "haven:nav-folded";
function useFolded() {
  const [folded, setFolded] = useState<GroupId[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(FOLDED) ?? "[]");
    } catch {
      return [];
    }
  });
  const toggle = (id: GroupId) =>
    setFolded((f) => {
      const next = f.includes(id) ? f.filter((g) => g !== id) : [...f, id];
      try {
        localStorage.setItem(FOLDED, JSON.stringify(next));
      } catch {
        /* the menu just won't remember */
      }
      return next;
    });
  return { folded, toggle };
}

/** The menu: Today and the ungrouped modules on top, then one section per group. */
function GroupedNav({ items, foldable = true }: { items: NavItem[]; foldable?: boolean }) {
  const { pathname } = useLocation();
  const { folded, toggle } = useFolded();
  const top = items.filter((i) => !i.group);
  return (
    <div className="flex flex-col gap-0.5">
      {top.map((item) => (
        <SideLink key={item.path} item={item} />
      ))}
      {GROUPS.map((g) => {
        const list = items.filter((i) => i.group === g.id);
        if (!list.length) return null;
        // A folded section still shows the page you're on.
        const open = !foldable || !folded.includes(g.id);
        const shown = open ? list : list.filter((i) => isActive(i, pathname));
        return (
          <div key={g.id} className={cn("flex flex-col gap-0.5", top.length || g !== GROUPS[0] ? "mt-3" : "")}>
            {foldable ? (
              <button
                onClick={() => toggle(g.id)}
                aria-expanded={open}
                className="group flex items-center justify-between rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint hover:text-muted"
              >
                {g.name}
                <ChevronDown className={cn("size-3.5 transition", open ? "opacity-0 group-hover:opacity-100" : "-rotate-90")} />
              </button>
            ) : (
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{g.name}</div>
            )}
            {shown.map((item) => (
              <SideLink key={item.path} item={item} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
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
  const active = isActive(item, pathname);
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      className={cn(
        "relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
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
  const active = isActive(item, pathname);
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
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col gap-6 px-4 py-6 md:flex">
        <Logo />
        <nav className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <GroupedNav items={NAV} />
        </nav>
        <div>
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
  const tabs = TAB_PATHS.map((p) => NAV.find((i) => i.path === p)!);
  const rest = NAV.filter((i) => !TAB_PATHS.includes(i.path));
  const restActive = [...rest, SETTINGS].some((i) => isActive(i, pathname));
  useEffect(() => setMore(false), [pathname]);

  return (
    <>
      <AnimatePresence>
        {more && (
          <>
            <motion.div className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[2px] md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMore(false)} />
            <motion.div
              className="fixed inset-x-3 bottom-24 z-40 flex max-h-[calc(100dvh-8rem)] flex-col gap-1 overflow-y-auto rounded-3xl border border-line bg-surface p-2 shadow-float md:hidden"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
            >
              <GroupedNav items={rest} foldable={false} />
              <div className="mt-2 border-t border-line pt-2">
                <SideLink item={SETTINGS} />
              </div>
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
