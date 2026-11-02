import {
  forwardRef,
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn, SWATCHES } from "@/lib/utils";

/* ---------- Button ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        size === "md" ? "h-10 px-4 text-sm" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-primary text-on-primary shadow-soft hover:opacity-90",
        variant === "secondary" && "border border-line bg-surface text-ink shadow-soft hover:border-line-strong hover:bg-raised",
        variant === "ghost" && "text-muted hover:bg-sunken hover:text-ink",
        variant === "danger" && "text-neg hover:bg-neg/10",
        className,
      )}
      {...props}
    />
  );
});

export function IconButton({
  className,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-sunken hover:text-ink active:scale-95",
        className,
      )}
      {...props}
    />
  );
}

/* ---------- Surfaces ---------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-3xl border border-line bg-surface shadow-card", className)}>{children}</div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-6 pt-5", className)}>
      <div>
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-1 text-[13px] font-medium text-muted">{eyebrow}</div>}
        <h1 className="font-serif text-[40px] leading-none tracking-tight sm:text-5xl">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-sunken text-muted">{icon}</div>
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ---------- Form controls ---------- */

const fieldBase =
  "w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] text-ink placeholder:text-faint transition-colors hover:border-line-strong focus:border-cal focus:outline-none focus:ring-4 focus:ring-cal/15";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(fieldBase, "h-11", className)} {...props} />;
});

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, "min-h-20 resize-none py-2.5", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(fieldBase, "h-11 cursor-pointer appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
    </div>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-muted">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  layoutId,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  layoutId: string;
}) {
  return (
    <div className={cn("inline-flex rounded-xl border border-line bg-sunken p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "relative flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
            value === o.value ? "text-ink" : "text-muted hover:text-ink",
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 rounded-lg bg-surface shadow-soft"
              transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
            />
          )}
          <span className="relative flex items-center justify-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SWATCHES.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-label={s.id}
          onClick={() => onChange(s.id)}
          className="flex size-8 items-center justify-center rounded-full transition-transform hover:scale-110"
          style={{ background: s.fg }}
        >
          {value === s.id && <Check className="size-4 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-sm font-medium"
    >
      <span
        className={cn(
          "relative h-6 w-10 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-line-strong",
        )}
      >
        <motion.span
          className="absolute top-1 size-4 rounded-full bg-surface shadow-soft"
          animate={{ left: checked ? 20 : 4 }}
          transition={{ type: "spring", bounce: 0.3, duration: 0.3 }}
        />
      </span>
      {label}
    </button>
  );
}

export function Progress({ value, color, className }: { value: number; color: string; className?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-sunken", className)}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ type: "spring", bounce: 0, duration: 0.8 }}
      />
    </div>
  );
}

/* ---------- Modal ---------- */

const openModals: symbol[] = [];

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  accent,
  size = "md",
  top = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  accent?: string;
  /** Compact width, for confirmations */
  size?: "md" | "sm" | "lg";
  /** Draw above other dialogs and overlays */
  top?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const id = Symbol();
    openModals.push(id);
    // Only the topmost dialog answers Escape.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openModals.at(-1) === id && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(id), 1);
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={cn("fixed inset-0 flex items-end justify-center sm:items-center sm:p-6", top ? "z-[80]" : "z-50")}>
          <motion.div
            className="absolute inset-0 bg-black/30 backdrop-blur-[3px] dark:bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn("relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-float sm:rounded-3xl", size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-3xl" : "sm:max-w-lg")}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
          >
            {accent && <div className="h-1 w-full" style={{ background: accent }} />}
            <div className="flex items-center justify-between px-6 pb-2 pt-5">
              <h2 className="font-serif text-[28px] leading-tight">{title}</h2>
              <IconButton label="Close" onClick={onClose} className="-mr-2">
                <X className="size-5" />
              </IconButton>
            </div>
            <div className="overflow-y-auto px-6 pb-6 pt-2">{children}</div>
            {footer && (
              <div className="flex items-center gap-2 border-t border-line bg-sunken/50 px-6 py-4">{footer}</div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
