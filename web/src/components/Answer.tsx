import { Fragment, useState, type ReactNode } from "react";
import { AlertTriangle, Bot, ChevronDown, Clock, Coins, Search, ShieldCheck, ShieldQuestion, Wrench } from "lucide-react";
import { fmt, type Citation, type Trace } from "../lib/api";

/** Minimal, safe markdown: paragraphs, - and 1. lists, **bold**, `code`, and [n] citation chips. No raw HTML. */
export function AnswerText({ text, onCite, citable }: { text: string; onCite?: (n: number) => void; citable?: Set<number> }) {
  const inline = (s: string, key: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d{1,2}\])/g).filter(Boolean).map((part, i) => {
      const k = `${key}-${i}`;
      if (part.startsWith("**")) return <strong key={k}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`")) return <code key={k}>{part.slice(1, -1)}</code>;
      const m = part.match(/^\[(\d{1,2})\]$/);
      if (m) {
        const n = Number(m[1]);
        return citable && !citable.has(n) ? null
          : <button key={k} type="button" className="cite" onClick={() => onCite?.(n)} aria-label={`Show source ${n}`}>{n}</button>;
      }
      return <Fragment key={k}>{part}</Fragment>;
    });
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="prose-answer">
      {blocks.map((b, bi) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) return <ul key={bi}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*[-*•]\s+/, ""), `${bi}-${i}`)}</li>)}</ul>;
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return <ol key={bi}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""), `${bi}-${i}`)}</li>)}</ol>;
        return <p key={bi}>{lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l.replace(/^#+\s*/, ""), `${bi}-${i}`)}</Fragment>)}</p>;
      })}
    </div>
  );
}

export function SourceCard({ c, active, onClick }: { c: Citation; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" id={`src-${c.n}`} onClick={onClick}
      className={`text-left w-full rounded-xl border p-3 transition ${active ? "border-amber-400 bg-amber-50/60 ring-2 ring-amber-200" : "border-line bg-white hover:border-ink-3/40"}`}>
      <div className="flex items-start gap-2">
        <span className="cite shrink-0">{c.n}</span>
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{c.title}</div>
          <div className="text-xs text-ink-3 truncate">{[c.page ? `Page ${c.page}` : null, c.heading].filter(Boolean).join(" · ") || "Passage"}</div>
        </div>
        <span className="ml-auto text-[11px] font-semibold text-ink-3 tabular-nums" title="Relevance after reranking">{Math.round(c.relevance * 100)}%</span>
      </div>
      <p className={`text-xs text-ink-2 mt-2 leading-relaxed ${active ? "" : "line-clamp-3"}`}>{c.content}</p>
    </button>
  );
}

export function VerificationBadge({ trace, answered }: { trace: Trace; answered: boolean }) {
  if (!answered) return <span className="chip bg-stone-100 text-ink-2"><ShieldQuestion className="size-3" /> Not found in your documents</span>;
  const v = trace.verification;
  if (trace.guardrail === "uncited_answer") return <span className="chip bg-amber-50 text-warn"><AlertTriangle className="size-3" /> No citations: verify manually</span>;
  if (!v || v.faithfulness == null) return null;
  const good = v.faithfulness >= 0.99;
  return (
    <span className={`chip ${good ? "bg-emerald-50 text-ok" : "bg-amber-50 text-warn"}`} title="Share of claims supported by the cited sources (LLM verification)">
      {good ? <ShieldCheck className="size-3" /> : <AlertTriangle className="size-3" />} {fmt.pct(v.faithfulness)} of claims supported
    </span>
  );
}

export function TraceDetails({ trace, usage }: { trace: Trace; usage?: { tokens_in: number; tokens_out: number; cost_usd: number } }) {
  const [open, setOpen] = useState(false);
  const t = trace.timings_ms ?? {};
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-semibold text-ink-3 hover:text-ink inline-flex items-center gap-1" aria-expanded={open}>
        <ChevronDown className={`size-3.5 transition ${open ? "rotate-180" : ""}`} /> How this answer was made
        <span className="font-normal">· {fmt.ms(t.total)}{usage ? ` · ${fmt.num(usage.tokens_in + usage.tokens_out)} tokens` : ""}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-line bg-paper/60 p-4 text-xs space-y-4">
          {trace.steps && (
            <div>
              <div className="font-semibold text-ink-2 mb-2 flex items-center gap-1.5"><Bot className="size-3.5" /> Agent steps</div>
              <ol className="space-y-1.5">
                {trace.steps.map((s, i) => (
                  <li key={i} className="flex gap-2 items-start">
                    <span className="size-5 shrink-0 rounded-full bg-night text-white grid place-items-center text-[10px] font-bold">{i + 1}</span>
                    <span className="min-w-0"><span className="font-mono font-medium"><Wrench className="inline size-3 mr-1" />{s.tool}</span>
                      <span className="text-ink-3 font-mono"> {JSON.stringify(s.args)}</span>
                      <span className="block text-ink-3">→ {s.summary} · {fmt.ms(s.ms)}</span></span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {trace.standalone_question && (
            <div><span className="font-semibold text-ink-2">Search query: </span><span className="font-mono">{trace.standalone_question}</span></div>
          )}
          {trace.retrieved && trace.retrieved.length > 0 && (
            <div>
              <div className="font-semibold text-ink-2 mb-2 flex items-center gap-1.5"><Search className="size-3.5" /> Retrieved passages
                <span className="font-normal text-ink-3">(top {trace.retrieved.length} of {trace.candidates} candidates)</span></div>
              <table className="w-full">
                <thead><tr className="text-ink-3 text-left"><th className="font-medium py-1">#</th><th className="font-medium">Document</th>
                  <th className="font-medium">Semantic rank</th><th className="font-medium">Keyword rank</th><th className="font-medium w-36">Relevance</th></tr></thead>
                <tbody>
                  {trace.retrieved.map((r) => (
                    <tr key={r.n} className="border-t border-line/70">
                      <td className="py-1.5 pr-2"><span className="cite">{r.n}</span></td>
                      <td className="pr-2 truncate max-w-[14rem]">{r.title}{r.page ? `, p. ${r.page}` : ""}</td>
                      <td className="tabular-nums">{r.vector_rank ?? "—"}</td>
                      <td className="tabular-nums">{r.keyword_rank ?? "—"}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-line overflow-hidden"><div className="h-full bg-brand-2 rounded-full" style={{ width: `${Math.round(r.relevance * 100)}%` }} /></div>
                          <span className="tabular-nums w-8 text-right">{Math.round(r.relevance * 100)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {trace.guardrail === "no_relevant_sources" && (
            <p className="text-ink-2"><ShieldQuestion className="inline size-3.5 mr-1" />Guardrail: no passage was relevant enough, so DocuMind declined to answer rather than guess.</p>
          )}
          {trace.verification && trace.verification.unsupported.length > 0 && (
            <div><div className="font-semibold text-warn mb-1">Claims the verifier could not match to a source</div>
              <ul className="list-disc pl-5 text-ink-2">{trace.verification.unsupported.map((u, i) => <li key={i}>{u}</li>)}</ul></div>
          )}
          <div className="flex flex-wrap gap-2">
            {Object.entries(t).map(([k, v]) => (
              <span key={k} className="chip bg-white border border-line text-ink-2"><Clock className="size-3" /> {k.replace(/_/g, " ")} {fmt.ms(v)}</span>
            ))}
            {usage && <span className="chip bg-white border border-line text-ink-2"><Coins className="size-3" /> {fmt.num(usage.tokens_in)} in / {fmt.num(usage.tokens_out)} out · {fmt.usd(usage.cost_usd)} at paid rates</span>}
          </div>
        </div>
      )}
    </div>
  );
}
