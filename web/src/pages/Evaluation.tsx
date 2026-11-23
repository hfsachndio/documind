import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FlaskConical, Play, Plus, Trash2, XCircle } from "lucide-react";
import { api, fmt, type DocumentRow, type Metrics } from "../lib/api";
import { canUpload } from "../lib/auth";
import { useWs } from "../components/AppShell";
import { LineChart } from "../components/Charts";
import { Empty, ErrorNote, Modal, PageHeader, Spinner, Stat, toast } from "../components/ui";

interface Case { id: string; question: string; expected_answer: string | null; expected_document_id: string | null; expected_document_title: string | null }
interface RunRow { id: string; config: Record<string, unknown>; pending: number; metrics: Metrics; created_at: string }
interface CaseResult {
  question: string; answer: string; answered: boolean; should_answer: boolean; hit?: boolean; reciprocal_rank?: number; faithfulness: number | null;
  answer_relevancy?: number | null; answer_correctness?: number | null; abstained_correctly: boolean | null; latency_ms: number; cost_usd: number;
  expected_document: string | null; retrieved: string[];
}

const METRICS: { key: keyof Metrics; label: string; hint: string }[] = [
  { key: "hit_rate", label: "Hit rate", hint: "expected document in the retrieved passages" },
  { key: "mrr", label: "MRR", hint: "how high the right document ranks (1 = first)" },
  { key: "context_precision", label: "Context precision", hint: "share of retrieved passages judged relevant" },
  { key: "faithfulness", label: "Faithfulness", hint: "answer claims supported by sources" },
  { key: "answer_relevancy", label: "Answer relevancy", hint: "LLM judge: does it address the question" },
  { key: "answer_correctness", label: "Correctness", hint: "LLM judge vs your reference answer" },
  { key: "abstention_accuracy", label: "Abstention", hint: "says 'not found' when it should" },
];

function CaseDialog({ ws, docs, onClose, onSaved }: { ws: string; docs: DocumentRow[]; onClose: () => void; onSaved: () => void }) {
  const [question, setQ] = useState("");
  const [expected, setE] = useState("");
  const [doc, setDoc] = useState("");
  const [err, setErr] = useState("");
  return (
    <Modal title="Add a test question" onClose={onClose}>
      <div className="space-y-4">
        <div><label className="label" htmlFor="q">Question</label><input id="q" className="input" value={question} onChange={(e) => setQ(e.target.value)} placeholder="How many days of annual leave do new employees get?" /></div>
        <div><label className="label" htmlFor="e">Reference answer <span className="font-normal text-ink-3">(optional, enables correctness)</span></label>
          <textarea id="e" className="input h-20 py-2" value={expected} onChange={(e) => setE(e.target.value)} /></div>
        <div><label className="label" htmlFor="d">Document that should be retrieved <span className="font-normal text-ink-3">(optional, enables hit rate & MRR)</span></label>
          <select id="d" className="input" value={doc} onChange={(e) => setDoc(e.target.value)}>
            <option value="">— none —</option>
            {docs.filter((d) => d.status === "ready").map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select></div>
        <p className="text-xs text-ink-3">Tip: leave both optional fields empty for a question your documents <em>can't</em> answer. It then measures whether DocuMind correctly refuses.</p>
        <ErrorNote>{err}</ErrorNote>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={question.trim().length < 3} onClick={async () => {
            try { await api(`/workspaces/${ws}/evals/cases`, { body: { question, expected_answer: expected || null, expected_document_id: doc || null } }); onSaved(); onClose(); }
            catch (x) { setErr((x as Error).message); }
          }}>Add question</button>
        </div>
      </div>
    </Modal>
  );
}

export default function Evaluation() {
  const { ws, role } = useWs();
  const [cases, setCases] = useState<Case[] | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<CaseResult[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    api<Case[]>(`/workspaces/${ws}/evals/cases`).then(setCases).catch(() => setCases([]));
    api<RunRow[]>(`/workspaces/${ws}/evals/runs`).then(setRuns).catch(() => {});
  }, [ws]);
  useEffect(() => { load(); api<DocumentRow[]>(`/workspaces/${ws}/documents`).then(setDocs).catch(() => {}); }, [load, ws]);

  const showRun = async (id: string) => setResults((await api<{ results: CaseResult[] }>(`/workspaces/${ws}/evals/runs/${id}`)).results);

  const run = async () => {
    setErr("");
    try {
      const r = await api<{ id: string; total: number }>(`/workspaces/${ws}/evals/runs`, { method: "POST" });
      setRunning({ done: 0, total: r.total });
      for (;;) {
        const step = await api<{ done: boolean; completed: number }>(`/workspaces/${ws}/evals/runs/${r.id}/next`, { method: "POST" });
        setRunning({ done: step.completed, total: r.total });
        if (step.done) break;
      }
      toast("Evaluation finished");
      load(); await showRun(r.id);
    } catch (x) { setErr((x as Error).message); } finally { setRunning(null); }
  };

  const latest = runs.find((r) => r.pending === 0);
  const history = [...runs].filter((r) => r.pending === 0).reverse();
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
      <PageHeader title="Evaluation" subtitle="Measure retrieval and answer quality on your own test questions, RAGAS-style. Re-run after changing documents to catch regressions."
        actions={canUpload(role) && <>
          <button className="btn-outline" onClick={() => setAdding(true)}><Plus className="size-4" /> Test question</button>
          <button className="btn-primary" onClick={() => void run()} disabled={!!running || !cases?.length}><Play className="size-4" /> Run evaluation</button>
        </>} />
      <ErrorNote>{err}</ErrorNote>
      {running && (
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-2 text-sm font-semibold"><Spinner className="size-4" /> Evaluating question {Math.min(running.done + 1, running.total)} of {running.total}…</div>
          <div className="h-2 rounded-full bg-line mt-3 overflow-hidden"><div className="h-full bg-brand-2 transition-all" style={{ width: `${(running.done / running.total) * 100}%` }} /></div>
          <p className="text-xs text-ink-3 mt-2">Each question runs the full pipeline plus LLM judges, one at a time to stay within the free API limits.</p>
        </div>
      )}
      {latest && (
        <section className="mb-8">
          <h2 className="font-semibold mb-3">Latest run <span className="text-ink-3 font-normal text-sm">· {fmt.ago(latest.created_at)} · {latest.metrics.cases} questions · {String(latest.config.chat_model)} · reranker {String(latest.config.reranker)}</span></h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {METRICS.map((m) => <Stat key={m.key} label={m.label} value={fmt.pct(latest.metrics[m.key] as number | null)} hint={m.hint} />)}
            <Stat label="Latency p50 / p95" value={`${fmt.ms(latest.metrics.latency_p50_ms)} / ${fmt.ms(latest.metrics.latency_p95_ms)}`} hint="end to end per question" />
          </div>
          <p className="text-xs text-ink-3 mt-2">Cost per question at paid Gemini rates: {fmt.usd(latest.metrics.cost_per_question_usd)} ({fmt.num(latest.metrics.avg_tokens)} tokens). On the free tier this is $0.</p>
        </section>
      )}
      {history.length >= 2 && (
        <section className="grid md:grid-cols-2 gap-4 mb-8">
          <LineChart title="Faithfulness across runs" max={1} format={(v) => fmt.pct(v)} points={history.map((r) => ({ label: fmt.date(r.created_at), value: r.metrics.faithfulness }))} />
          <LineChart title="Hit rate across runs" max={1} format={(v) => fmt.pct(v)} points={history.map((r) => ({ label: fmt.date(r.created_at), value: r.metrics.hit_rate }))} />
        </section>
      )}
      {results && (
        <section className="card p-5 mb-8 overflow-x-auto">
          <h2 className="font-semibold mb-3">Per-question results</h2>
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs text-ink-3"><th className="font-medium py-2">Question</th><th className="font-medium">Retrieved right doc</th><th className="font-medium">Faithful</th><th className="font-medium">Correct</th><th className="font-medium">Latency</th></tr></thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-t border-line align-top">
                  <td className="py-2.5 pr-3"><div className="font-medium">{r.question}</div><div className="text-xs text-ink-3 line-clamp-2 mt-0.5">{r.answer.replace(/\s*\[\d{1,2}\]/g, "")}</div></td>
                  <td>{r.hit === undefined ? (r.should_answer ? "—" : r.abstained_correctly ? <span className="text-ok inline-flex items-center gap-1"><CheckCircle2 className="size-4" /> refused</span> : <span className="text-bad inline-flex items-center gap-1"><XCircle className="size-4" /> answered</span>)
                    : r.hit ? <CheckCircle2 className="size-4 text-ok" aria-label="yes" /> : <XCircle className="size-4 text-bad" aria-label="no" />}</td>
                  <td className="tabular-nums">{fmt.pct(r.faithfulness)}</td>
                  <td className="tabular-nums">{fmt.pct(r.answer_correctness ?? null)}</td>
                  <td className="tabular-nums">{fmt.ms(r.latency_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section>
        <h2 className="font-semibold mb-3">Test questions {cases && <span className="text-ink-3 font-normal text-sm">({cases.length}, up to 25 per run)</span>}</h2>
        {cases === null ? <Spinner /> : cases.length === 0 ? (
          <Empty icon={<FlaskConical className="size-6" />} title="No test questions yet"
            action={canUpload(role) ? <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="size-4" /> Add a test question</button> : undefined}>
            Add questions your team really asks, with the expected answer and document. Include a few your documents can't answer to test the guardrails.
          </Empty>
        ) : (
          <div className="card divide-y divide-line">
            {cases.map((c) => (
              <div key={c.id} className="p-4 flex gap-3 items-start">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">{c.question}</div>
                  <div className="text-xs text-ink-3 mt-1 flex flex-wrap gap-x-3">
                    {c.expected_document_title && <span>Expected source: {c.expected_document_title}</span>}
                    {c.expected_answer && <span className="truncate max-w-md">Reference: {c.expected_answer}</span>}
                    {!c.expected_answer && !c.expected_document_id && <span className="text-warn">Should be refused (unanswerable)</span>}
                  </div>
                </div>
                {canUpload(role) && <button className="btn-ghost h-8 px-2 text-ink-3 hover:text-bad" aria-label="Delete test question"
                  onClick={async () => { await api(`/workspaces/${ws}/evals/cases/${c.id}`, { method: "DELETE" }); load(); }}><Trash2 className="size-4" /></button>}
              </div>
            ))}
          </div>
        )}
        {runs.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold mb-2">Run history</h3>
            <div className="flex flex-wrap gap-2">
              {runs.filter((r) => r.pending === 0).map((r) => (
                <button key={r.id} className="chip bg-white border border-line px-3 py-1.5 text-xs hover:border-ink-3" onClick={() => void showRun(r.id)}>
                  {fmt.date(r.created_at)} · faithfulness {fmt.pct(r.metrics.faithfulness)} · hit {fmt.pct(r.metrics.hit_rate)}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
      {adding && <CaseDialog ws={ws} docs={docs} onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  );
}
