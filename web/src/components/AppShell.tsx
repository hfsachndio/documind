import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { BarChart3, ChevronDown, FileText, FlaskConical, LogOut, Menu, MessageSquare, Plus, Settings2, Users, X } from "lucide-react";
import { api, type Role, type WorkspaceSummary } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ErrorNote, Logo, RoleBadge, Spinner, Toaster } from "./ui";

export interface WsContext { ws: string; role: Role; workspace: WorkspaceSummary; aiConfigured: boolean; reload: () => Promise<void> }
export const useWs = () => useOutletContext<WsContext>();

const NAV = [
  { to: "", label: "Ask", icon: MessageSquare, end: true },
  { to: "documents", label: "Documents", icon: FileText },
  { to: "evaluation", label: "Evaluation", icon: FlaskConical },
  { to: "usage", label: "Usage & cost", icon: BarChart3 },
  { to: "members", label: "Members & groups", icon: Users },
  { to: "settings", label: "Settings", icon: Settings2 },
];

function NewWorkspace() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  return (
    <div className="min-h-full grid place-items-center p-6">
      <form className="card p-8 w-full max-w-md space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        try { const w = await api<WorkspaceSummary>("/workspaces", { body: { name } }); await refresh(); nav(`/w/${w.id}`); }
        catch (x) { setErr((x as Error).message); }
      }}>
        <Logo />
        <h1 className="font-display text-3xl">Create a workspace</h1>
        <p className="text-sm text-ink-3">A workspace holds your team's documents. Invite people and control who can see what.</p>
        <input className="input" placeholder="e.g. Acme Support" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <ErrorNote>{err}</ErrorNote>
        <button className="btn-primary w-full">Create workspace</button>
      </form>
    </div>
  );
}

export default function AppShell() {
  const { ws = "" } = useParams();
  const { user, workspaces, loading, logout, refresh } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [aiConfigured, setAi] = useState(true);
  useEffect(() => { api<{ ai_configured: boolean }>("/config").then((c) => setAi(c.ai_configured)).catch(() => {}); }, []);
  useEffect(() => { setOpen(false); setSwitcher(false); }, [ws]);

  if (loading) return <div className="h-full grid place-items-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (ws === "new") return <NewWorkspace />;
  const workspace = workspaces.find((w) => w.id === ws);
  if (!workspace) return workspaces[0] ? <Navigate to={`/w/${workspaces[0].id}`} replace /> : <Navigate to="/w/new" replace />;

  const sidebar = (
    <aside className="flex flex-col h-full bg-night text-white/90 w-72 p-4">
      <div className="flex items-center justify-between px-2 pt-1 pb-5">
        <Link to="/" aria-label="DocuMind home"><Logo dark /></Link>
        <button className="lg:hidden text-white/70" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button>
      </div>
      <div className="relative mb-4">
        <button className="w-full flex items-center justify-between gap-2 rounded-xl bg-white/10 hover:bg-white/15 px-3 py-2.5 text-left"
          onClick={() => setSwitcher((s) => !s)} aria-expanded={switcher}>
          <span className="min-w-0">
            <span className="block text-[11px] uppercase tracking-wider text-white/50">Workspace</span>
            <span className="block truncate font-semibold">{workspace.name}</span>
          </span>
          <ChevronDown className="size-4 shrink-0" />
        </button>
        {switcher && (
          <div className="absolute z-20 mt-2 w-full rounded-xl bg-white text-ink shadow-xl p-1.5">
            {workspaces.map((w) => (
              <button key={w.id} className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-paper ${w.id === ws ? "font-semibold" : ""}`}
                onClick={() => nav(`/w/${w.id}`)}>
                <span className="truncate">{w.name}</span><RoleBadge role={w.role} />
              </button>
            ))}
            <button className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-brand hover:bg-paper" onClick={() => nav("/w/new")}>
              <Plus className="size-4" /> New workspace
            </button>
          </div>
        )}
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={label} to={to} end={end}
            className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? "bg-white text-night" : "hover:bg-white/10"}`}>
            <Icon className="size-4" /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto pt-4 border-t border-white/10">
        <div className="flex items-center gap-3 px-2">
          <div className="size-9 rounded-full bg-amber-400 text-night grid place-items-center font-bold">{user.name[0]?.toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{user.name}</div>
            <div className="text-xs text-white/50 truncate">{user.email}</div>
          </div>
          <button className="text-white/60 hover:text-white" onClick={() => { logout(); nav("/"); }} aria-label="Sign out" title="Sign out"><LogOut className="size-4" /></button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="h-full flex">
      <div className="hidden lg:block shrink-0">{sidebar}</div>
      {open && <div className="lg:hidden fixed inset-0 z-40 flex"><div className="shadow-2xl">{sidebar}</div><div className="flex-1 bg-ink/40" onClick={() => setOpen(false)} /></div>}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-line bg-white">
          <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button>
          <Logo />
        </header>
        {!aiConfigured && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm px-4 py-2">
            Running in offline demo mode: the Gemini API key isn't configured, so answers use a simple extractive fallback.
          </div>
        )}
        <main className="flex-1 min-h-0 overflow-y-auto scroll-thin">
          <Outlet context={{ ws, role: workspace.role, workspace, aiConfigured, reload: refresh } satisfies WsContext} />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
