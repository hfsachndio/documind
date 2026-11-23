import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Globe, Link2, Lock, Plus, RefreshCw, Trash2, Type, Upload, Users } from "lucide-react";
import { api, fmt, type DocumentRow, type Group } from "../lib/api";
import { canUpload, isAdmin } from "../lib/auth";
import { useWs } from "../components/AppShell";
import { Empty, ErrorNote, Modal, PageHeader, Spinner, toast } from "../components/ui";

const ICON: Record<string, typeof FileText> = { url: Globe, html: Globe, text: Type, markdown: FileText, pdf: FileText, docx: FileText };

function AccessPicker({ groups, access, setAccess, selected, setSelected }: {
  groups: Group[]; access: "workspace" | "groups"; setAccess: (a: "workspace" | "groups") => void; selected: string[]; setSelected: (s: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="label">Who can retrieve this document?</legend>
      <div className="grid grid-cols-2 gap-2">
        {([["workspace", Users, "Everyone in the workspace"], ["groups", Lock, "Only selected groups"]] as const).map(([k, Icon, label]) => (
          <label key={k} className={`card p-3 cursor-pointer text-sm flex items-center gap-2 ${access === k ? "border-brand-2 ring-2 ring-brand-2/20" : ""}`}>
            <input type="radio" name="access" className="sr-only" checked={access === k} onChange={() => setAccess(k)} />
            <Icon className="size-4 text-brand" /> {label}
          </label>
        ))}
      </div>
      {access === "groups" && (
        <div className="mt-3">
          {groups.length === 0 ? <p className="text-xs text-ink-3">No groups yet. Create groups (e.g. “HR”, “Finance”) on the Members & groups page.</p> : (
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <label key={g.id} className={`chip cursor-pointer px-3 py-1.5 text-xs border ${selected.includes(g.id) ? "bg-night text-white border-night" : "bg-white border-line text-ink-2"}`}>
                  <input type="checkbox" className="sr-only" checked={selected.includes(g.id)}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, g.id] : selected.filter((x) => x !== g.id))} />
                  {g.name}
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-ink-3 mt-2">Admins and owners can always see every document. Others need to be in one of these groups.</p>
        </div>
      )}
    </fieldset>
  );
}

function AddDialog({ ws, groups, onClose, onAdded, maxMb }: { ws: string; groups: Group[]; onClose: () => void; onAdded: () => void; maxMb: number }) {
  const [tab, setTab] = useState<"file" | "url" | "text">("file");
  const [files, setFiles] = useState<File[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [access, setAccess] = useState<"workspace" | "groups">("workspace");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = (list: FileList | null) => {
    const arr = Array.from(list ?? []);
    const big = arr.find((f) => f.size > maxMb * 1024 * 1024);
    setErr(big ? `${big.name} is larger than ${maxMb} MB.` : "");
    setFiles(arr.filter((f) => f.size <= maxMb * 1024 * 1024));
  };

  const submit = async () => {
    setErr("");
    if (access === "groups" && !selected.length) { setErr("Choose at least one group."); return; }
    const results: { title?: string; status: string; error?: string }[] = [];
    try {
      if (tab === "file") {
        for (const [i, f] of files.entries()) {
          setBusy(`Reading, chunking and embedding ${f.name} (${i + 1}/${files.length})…`);
          const form = new FormData();
          form.append("file", f); form.append("access", access); form.append("group_ids", JSON.stringify(selected));
          results.push({ title: f.name, ...(await api<{ status: string; error?: string }>(`/workspaces/${ws}/documents/upload`, { form })) });
        }
      } else if (tab === "url") {
        setBusy("Fetching the page and indexing it…");
        results.push(await api(`/workspaces/${ws}/documents/url`, { body: { url, access, group_ids: selected } }));
      } else {
        setBusy("Indexing your text…");
        results.push(await api(`/workspaces/${ws}/documents/text`, { body: { title, text, access, group_ids: selected } }));
      }
      const failed = results.filter((r) => r.status === "failed");
      if (failed.length) setErr(failed.map((f) => `${f.title ?? "Document"}: ${f.error}`).join(" "));
      else { toast(results.length > 1 ? `${results.length} documents indexed` : "Document indexed and ready to ask"); onClose(); }
      onAdded();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(""); }
  };

  const ready = tab === "file" ? files.length > 0 : tab === "url" ? /^https?:\/\/\S+\.\S+/.test(url) : title.trim() && text.trim().length >= 20;
  return (
    <Modal title="Add documents" onClose={busy ? () => {} : onClose}>
      <div className="flex gap-1 p-1 bg-paper rounded-xl mb-4">
        {([["file", Upload, "Upload files"], ["url", Link2, "Web page"], ["text", Type, "Paste text"]] as const).map(([k, Icon, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`flex-1 btn h-9 ${tab === k ? "bg-white shadow-sm text-ink" : "text-ink-3"}`}><Icon className="size-4" /> {label}</button>
        ))}
      </div>
      <div className="space-y-4">
        {tab === "file" && (
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
            onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
            className={`rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition ${drag ? "border-brand-2 bg-brand-soft" : "border-line hover:border-ink-3/50"}`}>
            <Upload className="size-7 mx-auto text-brand" />
            <p className="font-semibold mt-2">Drop files here or click to choose</p>
            <p className="text-xs text-ink-3 mt-1">PDF, Word (.docx), Markdown, HTML or text · up to {maxMb} MB each</p>
            <input ref={input} type="file" multiple hidden accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm,.csv" onChange={(e) => pick(e.target.files)} />
            {files.length > 0 && <ul className="mt-4 text-sm text-left space-y-1">{files.map((f) => <li key={f.name} className="flex justify-between"><span className="truncate">{f.name}</span><span className="text-ink-3">{(f.size / 1024).toFixed(0)} KB</span></li>)}</ul>}
          </div>
        )}
        {tab === "url" && (
          <div><label className="label" htmlFor="u">Page URL</label>
            <input id="u" className="input" placeholder="https://example.com/help/refund-policy" value={url} onChange={(e) => setUrl(e.target.value)} />
            <p className="text-xs text-ink-3 mt-1">Public pages and PDFs. Navigation, menus and footers are stripped automatically.</p></div>
        )}
        {tab === "text" && (
          <>
            <div><label className="label" htmlFor="t">Title</label><input id="t" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Onboarding checklist" /></div>
            <div><label className="label" htmlFor="x">Text or Markdown</label>
              <textarea id="x" className="input h-40 py-2" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste content here. Markdown headings (#) become sections." /></div>
          </>
        )}
        <AccessPicker groups={groups} access={access} setAccess={setAccess} selected={selected} setSelected={setSelected} />
        <ErrorNote>{err}</ErrorNote>
        {busy && <p className="text-sm text-ink-2 flex items-center gap-2"><Spinner className="size-4" /> {busy}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={!!busy}>Cancel</button>
          <button className="btn-primary" onClick={() => void submit()} disabled={!ready || !!busy}>Add to library</button>
        </div>
      </div>
    </Modal>
  );
}

function ViewDialog({ ws, doc, onClose }: { ws: string; doc: DocumentRow; onClose: () => void }) {
  const [d, setD] = useState<{ chunks: { ord: number; page: number | null; heading: string | null; content: string; token_count: number }[] } | null>(null);
  useEffect(() => { api<typeof d>(`/workspaces/${ws}/documents/${doc.id}`).then(setD).catch((x) => toast((x as Error).message, "err")); }, [ws, doc.id]);
  return (
    <Modal title={doc.title} onClose={onClose} wide>
      {doc.summary && <p className="text-sm text-ink-2 mb-4">{doc.summary}</p>}
      <div className="text-xs text-ink-3 mb-3">{doc.chunk_count} chunks · {fmt.num(doc.token_count)} tokens{doc.pages ? ` · ${doc.pages} pages` : ""} — this is exactly what retrieval searches over.</div>
      {!d ? <Spinner /> : (
        <ol className="space-y-2">
          {d.chunks.map((c) => (
            <li key={c.ord} className="rounded-xl border border-line p-3">
              <div className="text-[11px] font-semibold text-ink-3 mb-1">#{c.ord + 1}{c.page ? ` · page ${c.page}` : ""}{c.heading ? ` · ${c.heading}` : ""} · {c.token_count} tokens</div>
              <p className="text-sm leading-relaxed">{c.content}</p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

function AccessDialog({ ws, doc, groups, onClose, onSaved }: { ws: string; doc: DocumentRow; groups: Group[]; onClose: () => void; onSaved: () => void }) {
  const [access, setAccess] = useState(doc.access);
  const [selected, setSelected] = useState(doc.group_ids);
  const [err, setErr] = useState("");
  return (
    <Modal title={`Access: ${doc.title}`} onClose={onClose}>
      <div className="space-y-4">
        <AccessPicker groups={groups} access={access} setAccess={setAccess} selected={selected} setSelected={setSelected} />
        <ErrorNote>{err}</ErrorNote>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={async () => {
            try { await api(`/workspaces/${ws}/documents/${doc.id}`, { method: "PATCH", body: { access, group_ids: selected } }); toast("Access updated"); onSaved(); onClose(); }
            catch (x) { setErr((x as Error).message); }
          }}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

export default function Documents() {
  const { ws, role } = useWs();
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [maxMb, setMaxMb] = useState(4);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<DocumentRow | null>(null);
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const load = useCallback(() => {
    api<DocumentRow[]>(`/workspaces/${ws}/documents`).then(setDocs).catch((x) => toast((x as Error).message, "err"));
    api<Group[]>(`/workspaces/${ws}/groups`).then(setGroups).catch(() => {});
  }, [ws]);
  useEffect(() => { load(); api<{ max_upload_mb: number }>("/config").then((c) => setMaxMb(c.max_upload_mb)).catch(() => {}); }, [load]);

  const remove = async (d: DocumentRow) => {
    if (!confirm(`Delete “${d.title}” and its ${d.chunk_count} indexed chunks? This can't be undone.`)) return;
    try { await api(`/workspaces/${ws}/documents/${d.id}`, { method: "DELETE" }); toast("Document deleted"); load(); }
    catch (x) { toast((x as Error).message, "err"); }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
      <PageHeader title="Documents" subtitle="Everything DocuMind can answer from. Each file is cleaned, split into chunks, embedded and indexed for hybrid search."
        actions={<>
          <button className="btn-outline" onClick={load} aria-label="Refresh"><RefreshCw className="size-4" /></button>
          {canUpload(role) && <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="size-4" /> Add documents</button>}
        </>} />
      {docs === null ? <div className="grid place-items-center py-20"><Spinner /></div>
        : docs.length === 0 ? (
          <Empty icon={<FileText className="size-6" />} title="Your library is empty"
            action={canUpload(role) ? <button className="btn-primary" onClick={() => setAdding(true)}><Upload className="size-4" /> Add your first document</button> : undefined}>
            Add policies, handbooks, help-center articles, contracts or product docs. You can restrict sensitive files to specific groups.
          </Empty>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {docs.map((d) => {
              const Icon = ICON[d.source_type] ?? FileText;
              return (
                <article key={d.id} className="card p-5 flex flex-col">
                  <div className="flex items-start gap-3">
                    <div className="size-10 rounded-xl bg-brand-soft text-brand grid place-items-center shrink-0"><Icon className="size-5" /></div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold truncate" title={d.title}>{d.title}</h3>
                      <div className="text-xs text-ink-3 mt-0.5 flex flex-wrap gap-x-2">
                        <span className="uppercase">{d.source_type}</span>
                        {d.pages > 0 && <span>{d.pages} pages</span>}
                        <span>{d.chunk_count} chunks</span>
                        <span>added {fmt.ago(d.created_at)}{d.created_by_name ? ` by ${d.created_by_name}` : ""}</span>
                      </div>
                    </div>
                    {d.status === "ready" ? <span className="chip bg-emerald-50 text-ok">Ready</span>
                      : d.status === "failed" ? <span className="chip bg-red-50 text-bad">Failed</span>
                      : <span className="chip bg-amber-50 text-warn">Processing</span>}
                  </div>
                  {d.error && <p className="text-xs text-bad mt-3">{d.error}</p>}
                  {d.summary && <p className="text-sm text-ink-2 mt-3 line-clamp-3">{d.summary}</p>}
                  {d.source_url && <a href={d.source_url} target="_blank" rel="noreferrer" className="text-xs text-brand mt-2 truncate">{d.source_url}</a>}
                  <div className="mt-auto pt-4 flex items-center gap-2 flex-wrap">
                    {d.access === "workspace" ? <span className="chip bg-stone-100 text-ink-2"><Users className="size-3" /> Whole workspace</span>
                      : <span className="chip bg-night text-white"><Lock className="size-3" /> {d.groups.join(", ") || "Admins only"}</span>}
                    <span className="ml-auto flex gap-1">
                      {d.status === "ready" && <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => setViewing(d)}>View chunks</button>}
                      {isAdmin(role) && d.status === "ready" && <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => setEditing(d)}>Access</button>}
                      {canUpload(role) && <button className="btn-ghost h-8 px-2 text-ink-3 hover:text-bad" onClick={() => void remove(d)} aria-label={`Delete ${d.title}`}><Trash2 className="size-4" /></button>}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      {adding && <AddDialog ws={ws} groups={groups} maxMb={maxMb} onClose={() => setAdding(false)} onAdded={load} />}
      {viewing && <ViewDialog ws={ws} doc={viewing} onClose={() => setViewing(null)} />}
      {editing && <AccessDialog ws={ws} doc={editing} groups={groups} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
