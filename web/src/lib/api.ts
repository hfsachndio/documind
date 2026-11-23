// Thin typed client for the DocuMind API (same origin in production, proxied in dev).

export type Role = "owner" | "admin" | "member" | "viewer";
export interface User { id: string; name: string; email: string }
export interface WorkspaceSummary { id: string; name: string; role: Role; documents: number; members: number }
export interface Session { token: string; user: User; workspaces: WorkspaceSummary[] }

export interface Citation {
  n: number; chunk_id: number; document_id: string; title: string; page: number | null; heading: string | null;
  content: string; relevance: number; vector_rank: number | null; keyword_rank: number | null;
}
export interface Trace {
  mode?: "agent";
  standalone_question?: string;
  candidates?: number;
  guardrail?: "no_relevant_sources" | "uncited_answer";
  retrieved?: { n: number; title: string; page: number | null; relevance: number; vector_rank: number | null; keyword_rank: number | null }[];
  timings_ms?: Record<string, number>;
  verification?: { faithfulness: number | null; unsupported: string[] };
  steps?: { tool: string; args: Record<string, unknown>; ms: number; summary: string }[];
}
export interface AskResult {
  conversation_id: string; message_id: number; answer: string; answered: boolean; citations: Citation[]; trace: Trace;
  usage: { tokens_in: number; tokens_out: number; cost_usd: number };
}
export interface DocumentRow {
  id: string; title: string; source_type: string; source_url: string | null; status: "processing" | "ready" | "failed";
  error: string | null; access: "workspace" | "groups"; pages: number; chunk_count: number; token_count: number;
  summary: string | null; created_at: string; created_by_name: string | null; groups: string[]; group_ids: string[];
}
export interface Group { id: string; name: string; members: number; documents: number }
export interface Member { id: string; name: string; email: string; role: Role; group_ids: string[] }
export interface Metrics {
  cases: number; hit_rate: number | null; mrr: number | null; context_precision: number | null; faithfulness: number | null;
  answer_relevancy: number | null; answer_correctness: number | null; answer_rate: number | null; abstention_accuracy: number | null;
  latency_p50_ms: number | null; latency_p95_ms: number | null; avg_tokens: number; cost_per_question_usd: number;
}

const TOKEN_KEY = "documind.token";
export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

function headers(json = true): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  const t = tokenStore.get();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function parse<T>(r: Response): Promise<T> {
  if (r.ok) return r.json() as Promise<T>;
  let msg = `Request failed (${r.status})`;
  try {
    const body = await r.json();
    if (typeof body.detail === "string") msg = body.detail;
    else if (Array.isArray(body.detail)) msg = body.detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, "")).join(". ");
  } catch { /* not JSON */ }
  if (r.status === 401 && tokenStore.get()) onUnauthorized();
  throw new ApiError(r.status, msg);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: init.method ?? (init.body || init.form ? "POST" : "GET"),
    headers: headers(!init.form),
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  return parse<T>(r);
}

export type StreamEvent =
  | { type: "retrieval"; trace: Trace }
  | { type: "token"; text: string }
  | ({ type: "done" } & AskResult)
  | { type: "error"; error: string };

/** POST with a server-sent-events response. Falls back gracefully if the host buffers the stream. */
export async function streamAsk(ws: string, body: unknown, onEvent: (e: StreamEvent) => void, signal?: AbortSignal) {
  const r = await fetch(`/api/workspaces/${ws}/ask/stream`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) return parse(r);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (line.startsWith("data:")) onEvent(JSON.parse(line.slice(5)) as StreamEvent);
    }
  }
}

export const fmt = {
  pct: (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`),
  ms: (v: number | null | undefined) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`),
  usd: (v: number | null | undefined) => (v == null ? "—" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`),
  num: (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString()),
  date: (s: string) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
  ago: (s: string) => {
    const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    if (m < 1440) return `${Math.round(m / 60)} h ago`;
    return fmt.date(s);
  },
};
