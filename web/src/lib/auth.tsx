import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler, tokenStore, type Session, type User, type WorkspaceSummary } from "./api";

interface AuthState {
  user: User | null;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  login: (email: string, password: string) => Promise<Session>;
  signup: (name: string, email: string, password: string) => Promise<Session>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(!!tokenStore.get());

  const logout = useCallback(() => { tokenStore.set(null); setUser(null); setWorkspaces([]); }, []);
  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) { setLoading(false); return; }
    try {
      const me = await api<{ user: User; workspaces: WorkspaceSummary[] }>("/auth/me");
      setUser(me.user); setWorkspaces(me.workspaces);
    } catch { logout(); } finally { setLoading(false); }
  }, [logout]);
  useEffect(() => { void refresh(); }, [refresh]);

  const accept = (s: Session) => { tokenStore.set(s.token); setUser(s.user); setWorkspaces(s.workspaces); return s; };
  const value = useMemo<AuthState>(() => ({
    user, workspaces, loading, logout, refresh,
    login: async (email, password) => accept(await api<Session>("/auth/login", { body: { email, password } })),
    signup: async (name, email, password) => accept(await api<Session>("/auth/signup", { body: { name, email, password } })),
  }), [user, workspaces, loading, logout, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

export const canUpload = (role?: string) => role === "owner" || role === "admin" || role === "member";
export const isAdmin = (role?: string) => role === "owner" || role === "admin";
