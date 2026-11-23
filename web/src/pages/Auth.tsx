import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ErrorNote, Logo } from "../components/ui";

export default function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { user, workspaces, login, signup } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  if (user && !submitted) return <Navigate to={workspaces[0] ? `/w/${workspaces[0].id}` : "/w/new"} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy(true); setSubmitted(true);
    try {
      const s = mode === "login" ? await login(email, password) : await signup(name, email, password);
      nav(s.workspaces[0] ? `/w/${s.workspaces[0].id}${mode === "signup" ? "/documents" : ""}` : "/w/new");
    } catch (x) { setErr((x as Error).message); setSubmitted(false); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-full grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-night text-white p-12">
        <Link to="/"><Logo dark /></Link>
        <div>
          <p className="font-display text-5xl leading-tight">“Answers you can check,<br />from documents you control.”</p>
          <ul className="mt-8 space-y-2 text-white/75 text-sm">
            <li>• Upload PDFs, Word files, Markdown or a web page URL</li>
            <li>• Ask in plain language and get cited answers</li>
            <li>• Invite your team with roles and private groups</li>
          </ul>
        </div>
        <p className="text-xs text-white/40">DocuMind · RAG with hybrid search, reranking and guardrails</p>
      </div>
      <div className="grid place-items-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div className="lg:hidden mb-6"><Link to="/"><Logo /></Link></div>
          <h1 className="font-display text-4xl">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="text-sm text-ink-3">{mode === "login" ? "Sign in to your workspaces." : "You'll get a private workspace to upload documents into."}</p>
          {mode === "signup" && (
            <div><label className="label" htmlFor="name">Name</label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></div>
          )}
          <div><label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
          <div><label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required
              minLength={mode === "signup" ? 8 : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} />
            {mode === "signup" && <p className="text-xs text-ink-3 mt-1">At least 8 characters.</p>}</div>
          <ErrorNote>{err}</ErrorNote>
          <button className="btn-primary w-full h-11" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
          <p className="text-sm text-ink-3 text-center">
            {mode === "login" ? <>New to DocuMind? <Link className="text-brand font-semibold" to="/signup">Create an account</Link></>
              : <>Already have an account? <Link className="text-brand font-semibold" to="/login">Sign in</Link></>}
          </p>
        </form>
      </div>
    </div>
  );
}
