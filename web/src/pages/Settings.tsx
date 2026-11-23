import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { isAdmin, useAuth } from "../lib/auth";
import { useWs } from "../components/AppShell";
import { Modal, PageHeader, toast } from "../components/ui";

interface Config { provider: string; chat_model: string; fast_model: string; embed_model: string; reranker: string; top_k: number; max_upload_mb: number; ai_configured: boolean }

export default function Settings() {
  const { ws, role, workspace, reload } = useWs();
  const nav = useNavigate();
  const { logout } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const [pw, setPw] = useState("");
  const [name, setName] = useState(workspace.name);
  const [cfg, setCfg] = useState<Config | null>(null);
  useEffect(() => { setName(workspace.name); }, [workspace.name]);
  useEffect(() => { api<Config>("/config").then(setCfg).catch(() => {}); }, []);
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8 space-y-6">
      <PageHeader title="Settings" />
      {isAdmin(role) && (
        <form className="card p-5 space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          try { await api(`/workspaces/${ws}`, { method: "PATCH", body: { name } }); await reload(); toast("Workspace renamed"); }
          catch (x) { toast((x as Error).message, "err"); }
        }}>
          <h2 className="font-semibold">Workspace name</h2>
          <div className="flex gap-2"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Workspace name" /><button className="btn-primary">Save</button></div>
        </form>
      )}
      {cfg && (
        <section className="card p-5">
          <h2 className="font-semibold mb-3">AI pipeline</h2>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[["Provider", cfg.ai_configured ? "Google Gemini" : "Offline fallback (no API key)"], ["Answer model", cfg.chat_model],
              ["Fast model (rerank, verify, judge)", cfg.fast_model], ["Embeddings", `${cfg.embed_model} · 768 dimensions`],
              ["Reranker", cfg.reranker === "llm" ? "LLM relevance judge" : cfg.reranker], ["Passages per answer", String(cfg.top_k)],
              ["Upload limit", `${cfg.max_upload_mb} MB per file`], ["Vector store", "Postgres + pgvector (HNSW, cosine)"]].map(([k, v]) => (
              <div key={k}><dt className="text-xs font-semibold text-ink-3">{k}</dt><dd className="font-medium font-mono text-[13px]">{v}</dd></div>
            ))}
          </dl>
        </section>
      )}
      <section className="card p-5">
        <h2 className="font-semibold">API</h2>
        <p className="text-sm text-ink-3 mt-1">Everything in this app is available over a REST API with OpenAPI docs. Use your session token as a Bearer token.</p>
        <a className="btn-outline mt-3" href="/api/docs" target="_blank" rel="noreferrer">Open API reference</a>
      </section>
      {role === "owner" && (
        <section className="card p-5 border-red-200">
          <h2 className="font-semibold text-bad">Delete workspace</h2>
          <p className="text-sm text-ink-3 mt-1">Permanently deletes this workspace, its documents, chunks, conversations and evaluation runs. This can't be undone.</p>
          <button className="btn mt-3 bg-bad text-white hover:bg-red-800" onClick={async () => {
            if (prompt(`Type the workspace name (${workspace.name}) to confirm permanent deletion`) !== workspace.name) return;
            await api(`/workspaces/${ws}`, { method: "DELETE" }); await reload(); nav("/");
          }}>Delete workspace</button>
        </section>
      )}
      <section className="card p-5">
        <h2 className="font-semibold">Delete my account</h2>
        <p className="text-sm text-ink-3 mt-1">Deletes your account and every workspace you created, with their documents, conversations and evaluation runs. Workspaces other people created stay; you are removed from them.</p>
        <button className="btn-outline mt-3 text-bad" onClick={() => { setPw(""); setLeaving(true); }}>Delete my account</button>
      </section>
      {leaving && (
        <Modal title="Delete your account?" onClose={() => setLeaving(false)}>
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            try { await api("/auth/me", { method: "DELETE", body: { password: pw } }); logout(); nav("/"); toast("Your account was deleted"); }
            catch (x) { toast((x as Error).message, "err"); }
          }}>
            <p className="text-sm text-ink-2">This can't be undone. Enter your password to confirm.</p>
            <label className="label" htmlFor="del-pw">Password</label>
            <input id="del-pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setLeaving(false)}>Cancel</button><button className="btn bg-bad text-white hover:bg-red-800">Delete account</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
