import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export function Spinner({ className = "" }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={`inline-block size-5 rounded-full border-2 border-brand-2/25 border-t-brand-2 animate-spin ${className}`} />;
}

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <svg viewBox="0 0 64 64" className="size-7" aria-hidden>
        <rect width="64" height="64" rx="16" fill={dark ? "#fff" : "#1e1b4b"} />
        <path d="M18 14h16a14 14 0 0 1 0 28H24v8h-6z" fill="none" stroke="#f59e0b" strokeWidth="5" strokeLinejoin="round" />
        <circle cx="34" cy="28" r="4" fill={dark ? "#1e1b4b" : "#fff"} />
      </svg>
      <span className={`font-display text-2xl leading-none ${dark ? "text-white" : "text-ink"}`}>DocuMind</span>
    </span>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card p-10 text-center flex flex-col items-center">
      <div className="size-12 rounded-2xl bg-brand-soft text-brand grid place-items-center mb-4">{icon}</div>
      <h3 className="font-semibold text-lg">{title}</h3>
      {children && <p className="text-sm text-ink-3 mt-1 max-w-md">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] grid place-items-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] flex flex-col shadow-2xl`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="font-semibold">{title}</h2>
          <button className="btn-ghost h-8 px-2" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto scroll-thin">{children}</div>
      </div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="text-sm text-bad bg-red-50 border border-red-200 rounded-xl px-3 py-2">{children}</p>;
}

const ROLE_STYLE: Record<string, string> = {
  owner: "bg-night text-white", admin: "bg-brand-soft text-brand", member: "bg-emerald-50 text-emerald-800", viewer: "bg-stone-100 text-ink-2",
};
export function RoleBadge({ role }: { role: string }) {
  return <span className={`chip capitalize ${ROLE_STYLE[role] ?? ""}`}>{role}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="font-display text-4xl leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-ink-3 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-ink-3 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-ink-3 mt-1">{hint}</div>}
    </div>
  );
}

let pushToast: (msg: string, kind?: "ok" | "err") => void = () => {};
export const toast = (msg: string, kind: "ok" | "err" = "ok") => pushToast(msg, kind);

export function Toaster() {
  const [items, setItems] = useState<{ id: number; msg: string; kind: "ok" | "err" }[]>([]);
  useEffect(() => {
    pushToast = (msg, kind = "ok") => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, msg, kind }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
    };
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`rounded-xl px-4 py-3 text-sm shadow-lg text-white ${t.kind === "ok" ? "bg-night" : "bg-bad"}`}>{t.msg}</div>
      ))}
    </div>
  );
}
