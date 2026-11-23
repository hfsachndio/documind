import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowUp, Bot, FileUp, MessageSquare, Plus, Sparkles, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { api, streamAsk, type AskResult, type Citation, type DocumentRow, type Trace } from "../lib/api";
import { canUpload } from "../lib/auth";
import { useWs } from "../components/AppShell";
import { AnswerText, SourceCard, TraceDetails, VerificationBadge } from "../components/Answer";
import { Empty, Spinner, toast } from "../components/ui";

interface Msg {
  id?: number; role: "user" | "assistant"; content: string; citations?: Citation[]; trace?: Trace; answered?: boolean;
  usage?: AskResult["usage"]; pending?: boolean; mode?: "rag" | "agent"; feedback?: number | null;
}
interface ConvRow { id: string; title: string; created_at: string; messages: number }

function suggestions(docs: DocumentRow[]): string[] {
  const ready = docs.filter((d) => d.status === "ready");
  if (!ready.length) return [];
  const t = ready.slice(0, 3).map((d) => d.title);
  const out = [`Summarize “${t[0]}” in five bullet points`, `What are the most important rules or numbers in “${t[0]}”?`];
  if (t[1]) out.push(`Compare “${t[0]}” and “${t[1]}”: where do they differ?`);
  return out;
}

export default function Chat() {
  const { ws, role } = useWs();
  const { conv } = useParams();
  const nav = useNavigate();
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"rag" | "agent">("rag");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<{ msg: number; n: number } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const convRef = useRef<string | undefined>(conv);

  const loadConvs = useCallback(() => api<ConvRow[]>(`/workspaces/${ws}/conversations`).then(setConvs).catch(() => {}), [ws]);
  useEffect(() => { void loadConvs(); api<DocumentRow[]>(`/workspaces/${ws}/documents`).then(setDocs).catch(() => setDocs([])); }, [ws, loadConvs]);
  useEffect(() => {
    if (conv === convRef.current && msgs.length) return; // we just created it; keep the live thread
    convRef.current = conv;
    setActive(null);
    if (!conv) { setMsgs([]); return; }
    api<{ messages: (Msg & { citations: Citation[] })[] }>(`/workspaces/${ws}/conversations/${conv}`)
      .then((c) => setMsgs(c.messages.map((m) => ({ ...m, answered: m.role === "assistant" ? !(m.content || "").startsWith("I couldn't find") : undefined }))))
      .catch(() => nav(`/w/${ws}`));
  }, [conv, ws]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);

  const patchLast = (fn: (m: Msg) => Msg) => setMsgs((xs) => xs.map((m, i) => (i === xs.length - 1 ? fn(m) : m)));

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput(""); setBusy(true); setActive(null);
    setMsgs((xs) => [...xs, { role: "user", content: q }, { role: "assistant", content: "", pending: true, mode }]);
    const body = { question: q, conversation_id: convRef.current, mode };
    const finish = (r: AskResult) => {
      patchLast(() => ({ id: r.message_id, role: "assistant", content: r.answer, citations: r.citations, trace: r.trace, answered: r.answered, usage: r.usage, mode }));
      if (!convRef.current) { convRef.current = r.conversation_id; nav(`/w/${ws}/c/${r.conversation_id}`, { replace: true }); }
      void loadConvs();
    };
    try {
      if (mode === "agent") {
        finish(await api<AskResult>(`/workspaces/${ws}/ask`, { body }));
      } else {
        let done = false;
        await streamAsk(ws, body, (e) => {
          if (e.type === "retrieval") patchLast((m) => ({ ...m, trace: e.trace }));
          else if (e.type === "token") patchLast((m) => ({ ...m, content: m.content + e.text }));
          else if (e.type === "done") { done = true; finish(e); }
          else if (e.type === "error") throw new Error(e.error);
        });
        if (!done) throw new Error("The answer was interrupted. Please try again.");
      }
    } catch (x) {
      patchLast(() => ({ role: "assistant", content: (x as Error).message, answered: false, trace: {} }));
      toast((x as Error).message, "err");
    } finally { setBusy(false); }
  };

  const vote = async (m: Msg, value: number) => {
    if (!m.id) return;
    const v = m.feedback === value ? 0 : value;
    await api(`/workspaces/${ws}/messages/${m.id}/feedback`, { body: { value: v } }).catch(() => {});
    setMsgs((xs) => xs.map((x) => (x === m ? { ...x, feedback: v || null } : x)));
  };

  const cite = (msgIndex: number, n: number) => {
    setActive({ msg: msgIndex, n });
    setTimeout(() => document.getElementById(`src-${n}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30);
  };
  const activeMsg = active ? msgs[active.msg] : [...msgs].reverse().find((m) => m.role === "assistant" && m.citations?.length);
  const sources = activeMsg?.citations ?? [];
  const noDocs = docs !== null && !docs.some((d) => d.status === "ready");

  return (
    <div className="h-full flex">
      <aside className="hidden xl:flex flex-col w-64 shrink-0 border-r border-line bg-white/60 p-3">
        <button className="btn-outline w-full mb-3" onClick={() => { convRef.current = undefined; setMsgs([]); nav(`/w/${ws}`); }}><Plus className="size-4" /> New chat</button>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 px-2 mb-1">Your conversations</div>
        <div className="flex-1 overflow-y-auto scroll-thin space-y-0.5">
          {convs.length === 0 && <p className="text-xs text-ink-3 px-2 py-2">Questions you ask are saved here.</p>}
          {convs.map((c) => (
            <div key={c.id} className={`group flex items-center rounded-lg ${c.id === conv ? "bg-brand-soft" : "hover:bg-black/5"}`}>
              <Link to={`/w/${ws}/c/${c.id}`} className="flex-1 min-w-0 px-2 py-2 text-sm truncate">{c.title}</Link>
              <button className="opacity-0 group-hover:opacity-100 p-1.5 text-ink-3 hover:text-bad" aria-label="Delete conversation"
                onClick={async () => { await api(`/workspaces/${ws}/conversations/${c.id}`, { method: "DELETE" }); if (c.id === conv) nav(`/w/${ws}`); void loadConvs(); }}>
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 overflow-y-auto scroll-thin px-4 sm:px-8 py-6">
          <div className="max-w-3xl mx-auto">
            {docs === null ? <div className="grid place-items-center py-20"><Spinner /></div>
              : msgs.length === 0 ? (
                noDocs ? (
                  <Empty icon={<FileUp className="size-6" />} title="Add documents to start asking"
                    action={canUpload(role) ? <Link to="documents" className="btn-primary"><FileUp className="size-4" /> Upload documents</Link> : undefined}>
                    {canUpload(role) ? "Upload PDFs, Word files, Markdown or a web page. DocuMind indexes them in seconds, then answers questions with citations."
                      : "This workspace has no documents you can access yet. Ask an admin to share some with you."}
                  </Empty>
                ) : (
                  <div className="text-center pt-10">
                    <div className="size-14 rounded-2xl bg-night text-amber-400 grid place-items-center mx-auto"><Sparkles className="size-6" /></div>
                    <h1 className="font-display text-4xl mt-4">What would you like to know?</h1>
                    <p className="text-sm text-ink-3 mt-1">Answers come only from the {docs.filter((d) => d.status === "ready").length} documents you can access, with citations.</p>
                    <div className="mt-6 flex flex-col gap-2 max-w-xl mx-auto">
                      {suggestions(docs).map((s) => (
                        <button key={s} className="card px-4 py-3 text-sm text-left hover:border-brand-2/50" onClick={() => void ask(s)}>{s}</button>
                      ))}
                    </div>
                  </div>
                )
              ) : (
                <div className="space-y-6">
                  {msgs.map((m, i) => m.role === "user" ? (
                    <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-night text-white px-4 py-2.5 text-sm whitespace-pre-wrap">{m.content}</div></div>
                  ) : (
                    <div key={i} className="flex gap-3">
                      <div className="size-8 shrink-0 rounded-xl bg-white border border-line grid place-items-center">{m.mode === "agent" ? <Bot className="size-4 text-brand" /> : <Sparkles className="size-4 text-amber-600" />}</div>
                      <div className="min-w-0 flex-1">
                        {m.pending && !m.content ? (
                          <div className="text-sm text-ink-3 flex items-center gap-2 py-1.5"><Spinner className="size-4" />
                            {m.mode === "agent" ? "Agent is planning and using tools…" : m.trace ? `Found ${m.trace.retrieved?.length ?? 0} relevant passages, writing the answer…` : "Searching your documents…"}</div>
                        ) : (
                          <div className={`text-[15px] ${m.pending ? "caret" : ""}`}>
                            <AnswerText text={m.content} onCite={(n) => cite(i, n)} citable={m.pending ? undefined : new Set((m.citations ?? []).map((c) => c.n))} />
                          </div>
                        )}
                        {!m.pending && m.trace && (
                          <>
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <VerificationBadge trace={m.trace} answered={m.answered !== false} />
                              {m.citations && m.citations.length > 0 && <span className="chip bg-cite-soft text-cite">{m.citations.length} source{m.citations.length > 1 ? "s" : ""}</span>}
                              {m.id && (
                                <span className="ml-auto flex gap-1">
                                  <button className={`p-1.5 rounded-lg hover:bg-black/5 ${m.feedback === 1 ? "text-ok" : "text-ink-3"}`} onClick={() => void vote(m, 1)} aria-label="Helpful"><ThumbsUp className="size-3.5" /></button>
                                  <button className={`p-1.5 rounded-lg hover:bg-black/5 ${m.feedback === -1 ? "text-bad" : "text-ink-3"}`} onClick={() => void vote(m, -1)} aria-label="Not helpful"><ThumbsDown className="size-3.5" /></button>
                                </span>
                              )}
                            </div>
                            {m.citations && m.citations.length > 0 && (
                              <div className="lg:hidden mt-3 space-y-2">{m.citations.map((c) => <SourceCard key={c.n} c={c} active={active?.msg === i && active.n === c.n} onClick={() => cite(i, c.n)} />)}</div>
                            )}
                            <TraceDetails trace={m.trace} usage={m.usage} />
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={bottom} />
                </div>
              )}
          </div>
        </div>

        <div className="border-t border-line bg-white/80 backdrop-blur px-4 sm:px-8 py-4">
          <form className="max-w-3xl mx-auto" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
            <div className="card flex items-end gap-2 p-2 focus-within:ring-2 focus-within:ring-brand-2/40">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} disabled={noDocs}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
                placeholder={noDocs ? "Add documents first" : mode === "agent" ? "Ask a multi-step question: compare, summarize, calculate…" : "Ask a question about your documents…"}
                className="flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none max-h-40" aria-label="Question" />
              <button className="btn-primary size-10 p-0 shrink-0" disabled={busy || !input.trim()} aria-label="Ask"><ArrowUp className="size-4" /></button>
            </div>
            <div className="flex items-center gap-1 mt-2 text-xs">
              <span className="text-ink-3 mr-1">Mode:</span>
              {(["rag", "agent"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setMode(k)}
                  className={`chip px-2.5 py-1 ${mode === k ? "bg-night text-white" : "bg-black/5 text-ink-2 hover:bg-black/10"}`}>
                  {k === "rag" ? <><MessageSquare className="size-3" /> Answer</> : <><Bot className="size-3" /> Agent</>}
                </button>
              ))}
              <span className="text-ink-3 ml-2 hidden sm:inline">{mode === "rag" ? "Fast cited answer (streams)." : "Plans, searches several times, compares and calculates."}</span>
            </div>
          </form>
        </div>
      </section>

      <aside className="hidden lg:flex flex-col w-80 shrink-0 border-l border-line bg-white/60">
        <div className="px-4 py-3 border-b border-line text-sm font-semibold">Sources</div>
        <div className="flex-1 overflow-y-auto scroll-thin p-3 space-y-2">
          {sources.length === 0 ? <p className="text-xs text-ink-3 p-2">Click a citation number in an answer to see the exact passage it came from.</p>
            : sources.map((c) => <SourceCard key={c.n} c={c} active={active ? active.n === c.n && msgs[active.msg] === activeMsg : false}
                onClick={() => setActive({ msg: msgs.indexOf(activeMsg!), n: c.n })} />)}
        </div>
      </aside>
    </div>
  );
}
