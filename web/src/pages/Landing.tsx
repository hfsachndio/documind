import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, Bot, FileSearch, FlaskConical, Layers, LockKeyhole, Quote, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "../components/ui";

const FEATURES = [
  { icon: Layers, title: "Hybrid search + reranking", body: "Every question runs a pgvector semantic search and a Postgres full-text search, fuses them with reciprocal rank fusion, then reranks the best passages with an LLM judge." },
  { icon: Quote, title: "Cited, grounded answers", body: "Answers are written only from your documents, with numbered citations you can click to see the exact passage, page and section." },
  { icon: ShieldCheck, title: "Hallucination guardrails", body: "If nothing relevant is found, DocuMind says so instead of guessing. Each answer is checked claim by claim against its sources." },
  { icon: Bot, title: "Agent mode", body: "For multi-part questions the AI plans and uses tools: search, read, compare documents and calculate, and shows every step it took." },
  { icon: LockKeyhole, title: "Permission-aware retrieval", body: "Workspaces, roles and groups. A document restricted to HR is filtered out in the database before ranking, so it can never leak into an answer." },
  { icon: FlaskConical, title: "Built-in evaluation", body: "Write test questions and measure hit rate, MRR, faithfulness, answer relevancy, correctness, latency and cost per question over time." },
];

const STEPS = [
  { n: "1", title: "Ingest", body: "PDF, Word, Markdown, text and web pages are parsed, cleaned of headers and page numbers, and split into heading-aware chunks with overlap." },
  { n: "2", title: "Embed", body: "Each chunk is embedded with its document title and section for context, and stored in Postgres with pgvector and a full-text index." },
  { n: "3", title: "Retrieve", body: "Semantic and keyword results are fused, filtered by your permissions, and reranked for relevance." },
  { n: "4", title: "Answer & verify", body: "Gemini writes a cited answer from the top passages; a second pass checks that every claim is supported." },
];

function Pipeline() {
  const box = (x: number, y: number, w: number, label: string, sub: string, accent = false) => (
    <g>
      <rect x={x} y={y} width={w} height="58" rx="14" fill={accent ? "#1e1b4b" : "#fff"} stroke={accent ? "#1e1b4b" : "#e6e2d8"} />
      <text x={x + w / 2} y={y + 26} textAnchor="middle" fontSize="14" fontWeight="600" fill={accent ? "#fff" : "#14121f"}>{label}</text>
      <text x={x + w / 2} y={y + 44} textAnchor="middle" fontSize="11" fill={accent ? "#c7d2fe" : "#6e6a82"}>{sub}</text>
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number) => <path d={`M${x1} ${y1} L${x2} ${y2}`} stroke="#a8a29e" strokeWidth="1.5" markerEnd="url(#ah)" fill="none" />;
  return (
    <svg viewBox="0 0 980 300" className="w-full h-auto" role="img" aria-label="DocuMind pipeline: question, query rewrite, semantic and keyword search, permission filter, fusion, rerank, grounded answer, verification">
      <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#a8a29e" /></marker></defs>
      {box(10, 121, 130, "Question", "chat or API")}
      {arrow(140, 150, 175, 150)}
      {box(178, 121, 140, "Rewrite", "follow-ups → standalone")}
      {arrow(318, 140, 360, 75)}{arrow(318, 160, 360, 225)}
      {box(362, 46, 170, "Semantic search", "pgvector · HNSW cosine")}
      {box(362, 196, 170, "Keyword search", "Postgres full-text · ts_rank")}
      <rect x="350" y="20" width="194" height="260" rx="18" fill="none" stroke="#4f46e5" strokeDasharray="5 5" />
      <text x="447" y="294" textAnchor="middle" fontSize="11" fill="#4f46e5" fontWeight="600">permission filter in SQL</text>
      {arrow(532, 75, 575, 140)}{arrow(532, 225, 575, 160)}
      {box(578, 121, 120, "RRF fusion", "rank-based merge")}
      {arrow(698, 150, 730, 150)}
      {box(733, 121, 110, "Rerank", "LLM relevance")}
      {arrow(843, 150, 868, 150)}
      {box(871, 96, 100, "Answer", "cited · Gemini", true)}
      {box(871, 170, 100, "Verify", "claims vs sources")}
    </svg>
  );
}

export default function Landing() {
  return (
    <div className="min-h-full">
      <header className="max-w-6xl mx-auto flex items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <a href="https://github.com/hfsachndio/documind" className="btn-ghost hidden sm:inline-flex">GitHub</a>
          <a href="/api/docs" className="btn-ghost hidden sm:inline-flex">API docs</a>
          <Link to="/login" className="btn-ghost">Sign in</Link>
          <Link to="/signup" className="btn-primary">Get started</Link>
        </nav>
      </header>

      <section className="max-w-6xl mx-auto px-6 pt-10 pb-16 grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
        <div>
          <span className="chip bg-brand-soft text-brand"><Sparkles className="size-3" /> Retrieval-augmented generation</span>
          <h1 className="font-display text-6xl sm:text-7xl leading-[0.95] mt-5">Ask your documents.<br /><em className="text-brand">Trust the answer.</em></h1>
          <p className="text-lg text-ink-2 mt-6 max-w-xl">
            DocuMind reads your PDFs, Word files and web pages, then answers questions with citations to the exact page.
            When the answer isn't in your documents, it tells you instead of making something up.
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link to="/signup" className="btn-primary h-12 px-6 text-base">Create a free workspace <ArrowRight className="size-4" /></Link>
            <a href="#how" className="btn-outline h-12 px-6 text-base">How it works</a>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-8 text-sm text-ink-3">
            <span className="inline-flex items-center gap-1.5"><BadgeCheck className="size-4 text-ok" /> Cited answers</span>
            <span className="inline-flex items-center gap-1.5"><BadgeCheck className="size-4 text-ok" /> Role & group permissions</span>
            <span className="inline-flex items-center gap-1.5"><BadgeCheck className="size-4 text-ok" /> Measured with evals</span>
          </div>
        </div>
        <div className="card p-5 shadow-xl shadow-indigo-900/5">
          <div className="text-xs font-semibold text-ink-3 uppercase tracking-wide mb-3">What an answer looks like</div>
          <div className="rounded-xl bg-paper p-4 text-sm">
            <div className="font-semibold mb-2">“How much annual leave do I get, and can I carry it over?”</div>
            <p className="leading-relaxed text-ink-2">
              Full-time employees get 24 days of paid annual leave per year<span className="cite">1</span>, and up to 5 unused days can be carried
              into the next year<span className="cite">1</span>. Requests go through the HR portal two weeks in advance<span className="cite">2</span>.
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs text-ink-3"><ShieldCheck className="size-3.5 text-ok" /> 3 of 3 claims supported by sources</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-line p-2.5"><span className="cite">1</span> Employee Handbook · p. 4 · Annual leave</div>
            <div className="rounded-lg border border-line p-2.5"><span className="cite">2</span> HR Portal Guide · p. 2 · Requests</div>
          </div>
          <p className="text-[11px] text-ink-3 mt-3">Illustration of the answer format.</p>
        </div>
      </section>

      <section id="how" className="bg-white border-y border-line">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="font-display text-5xl">How an answer is made</h2>
          <p className="text-ink-3 mt-2 max-w-2xl">A production RAG pipeline, end to end: nothing is a black box. Every answer shows its retrieved passages, scores, timings and cost.</p>
          <div className="card p-4 sm:p-6 mt-8 overflow-x-auto"><div className="min-w-[760px]"><Pipeline /></div></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
            {STEPS.map((s) => (
              <div key={s.n} className="card p-5">
                <div className="size-8 rounded-full bg-night text-white grid place-items-center font-semibold text-sm">{s.n}</div>
                <h3 className="font-semibold mt-3">{s.title}</h3>
                <p className="text-sm text-ink-3 mt-1">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="font-display text-5xl">Built like a real product</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="card p-6">
              <div className="size-10 rounded-xl bg-brand-soft text-brand grid place-items-center"><Icon className="size-5" /></div>
              <h3 className="font-semibold mt-4">{title}</h3>
              <p className="text-sm text-ink-3 mt-1.5 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-16">
        <div className="card p-8 grid md:grid-cols-2 gap-8">
          <div>
            <h2 className="font-display text-4xl">The stack</h2>
            <p className="text-sm text-ink-3 mt-2">Open, swappable parts. The LLM layer is provider-neutral, and the API is documented with OpenAPI.</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[["LLM", "Google Gemini (Flash / Flash-Lite)"], ["Embeddings", "gemini-embedding-001, 768-d"], ["Vector store", "Postgres + pgvector (HNSW)"],
              ["Keyword search", "Postgres full-text (tsvector)"], ["Backend", "Python · FastAPI"], ["Frontend", "React · TypeScript · Tailwind"],
              ["Evaluation", "RAGAS-style metrics + LLM judge"], ["Deploy", "Vercel + Neon · Docker / AWS-ready"]].map(([k, v]) => (
              <div key={k}><dt className="text-xs font-semibold text-ink-3">{k}</dt><dd className="font-medium">{v}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      <section className="bg-night text-white">
        <div className="max-w-6xl mx-auto px-6 py-16 flex flex-wrap items-center justify-between gap-6">
          <div>
            <h2 className="font-display text-5xl">Put your documents to work.</h2>
            <p className="text-white/70 mt-2 flex items-center gap-2"><FileSearch className="size-4" /> Free to try. Your workspace starts empty and private.</p>
          </div>
          <Link to="/signup" className="btn h-12 px-6 bg-amber-400 text-night hover:bg-amber-300 text-base">Create your workspace <ArrowRight className="size-4" /></Link>
        </div>
      </section>
      <footer className="max-w-6xl mx-auto px-6 py-8 text-sm text-ink-3 flex flex-wrap justify-between gap-2">
        <span>DocuMind · Designed and developed by Hafsah Zulfiqar</span>
        <span><a className="hover:text-ink" href="https://github.com/hfsachndio/documind">Source on GitHub</a> · <a className="hover:text-ink" href="/api/docs">API reference</a></span>
      </footer>
    </div>
  );
}
