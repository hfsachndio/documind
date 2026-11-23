import { useEffect, useState } from "react";
import { api, fmt } from "../lib/api";
import { useWs } from "../components/AppShell";
import { BarChart, LineChart } from "../components/Charts";
import { PageHeader, Spinner, Stat } from "../components/ui";

interface UsageData {
  scope: "workspace" | "you";
  totals: { questions: number; answered: number; tokens_in: number; tokens_out: number; cost_usd: number; p50: number | null; p95: number | null; agent_questions: number };
  daily: { day: string; questions: number; answered: number; cost_usd: number; avg_ms: number }[];
  library: { documents: number; chunks: number; tokens: number };
  feedback: { up: number; down: number };
}

function last14(daily: UsageData["daily"]) {
  const by = new Map(daily.map((d) => [d.day, d]));
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000);
    const key = d.toISOString().slice(0, 10);
    return { key, label: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }), row: by.get(key) };
  });
}

export default function Usage() {
  const { ws } = useWs();
  const [u, setU] = useState<UsageData | null>(null);
  useEffect(() => { api<UsageData>(`/workspaces/${ws}/usage`).then(setU).catch(() => {}); }, [ws]);
  if (!u) return <div className="grid place-items-center py-20"><Spinner /></div>;
  const t = u.totals;
  const days = last14(u.daily);
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
      <PageHeader title="Usage & cost" subtitle={`Last 30 days, ${u.scope === "workspace" ? "whole workspace" : "your questions"}. Every question is logged with its latency, tokens and cost.`} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Questions" value={fmt.num(t.questions)} hint={`${fmt.num(t.agent_questions)} in agent mode`} />
        <Stat label="Answered from documents" value={t.questions ? fmt.pct(t.answered / t.questions) : "—"} hint="the rest were refused as not found" />
        <Stat label="Latency p50 / p95" value={`${fmt.ms(t.p50)} / ${fmt.ms(t.p95)}`} hint="end to end" />
        <Stat label="Cost at paid rates" value={fmt.usd(t.cost_usd)} hint={`${fmt.num(t.tokens_in + t.tokens_out)} tokens · free tier: $0`} />
        <Stat label="Documents" value={fmt.num(u.library.documents)} />
        <Stat label="Indexed chunks" value={fmt.num(u.library.chunks)} hint={`${fmt.num(u.library.tokens)} tokens`} />
        <Stat label="Helpful" value={fmt.num(u.feedback.up)} hint="thumbs up on answers" />
        <Stat label="Not helpful" value={fmt.num(u.feedback.down)} hint="thumbs down on answers" />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <BarChart title="Questions per day" points={days.map((d) => ({ label: d.label, value: d.row?.questions ?? 0 }))} />
        <LineChart title="Average latency per day" format={(v) => fmt.ms(v)} points={days.map((d) => ({ label: d.label, value: d.row ? Number(d.row.avg_ms) : null }))} />
      </div>
    </div>
  );
}
