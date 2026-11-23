import { useState } from "react";

/** Single-series charts: one hue (#4f46e5), thin marks, recessive grid, hover tooltip, optional table view. */
interface Point { label: string; value: number | null }

const W = 640, H = 220, PAD = { l: 44, r: 16, t: 16, b: 30 };

function scale(points: Point[], max?: number) {
  const vals = points.map((p) => p.value ?? 0);
  const top = max ?? Math.max(1, ...vals) * 1.15;
  const x = (i: number) => PAD.l + (points.length <= 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (points.length - 1));
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  return { x, y, top };
}

function Grid({ top, y, format }: { top: number; y: (v: number) => number; format: (v: number) => string }) {
  const ticks = [0, top / 2, top];
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#e6e2d8" strokeWidth="1" />
          <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6e6a82">{format(t)}</text>
        </g>
      ))}
    </g>
  );
}

function Frame({ title, children, points, format, showTable }: { title: string; children: React.ReactNode; points: Point[]; format: (v: number) => string; showTable: boolean }) {
  return (
    <figure className="card p-4">
      <figcaption className="text-sm font-semibold mb-2">{title}</figcaption>
      {children}
      {showTable && (
        <table className="w-full text-xs mt-3">
          <thead><tr className="text-ink-3 text-left"><th className="font-medium py-1">Label</th><th className="font-medium text-right">Value</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.label} className="border-t border-line"><td className="py-1">{p.label}</td><td className="text-right tabular-nums">{p.value == null ? "—" : format(p.value)}</td></tr>)}</tbody>
        </table>
      )}
    </figure>
  );
}

export function LineChart({ title, points, format = (v) => String(Math.round(v)), max }: { title: string; points: Point[]; format?: (v: number) => string; max?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const { x, y, top } = scale(points, max);
  const defined = points.map((p, i) => ({ ...p, i })).filter((p) => p.value != null);
  const d = defined.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.value!)}`).join(" ");
  return (
    <Frame title={title} points={points} format={format} showTable={table}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={title}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
          setHover(best);
        }}>
        <Grid top={top} y={y} format={format} />
        {points.map((p, i) => (points.length <= 8 || i % Math.ceil(points.length / 8) === 0) && (
          <text key={p.label} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#6e6a82">{p.label}</text>
        ))}
        <path d={d} fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {defined.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.value!)} r="4" fill="#4f46e5" stroke="#fff" strokeWidth="2" />)}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="#14121f" strokeOpacity="0.2" />
            <g transform={`translate(${Math.min(Math.max(x(hover) - 60, PAD.l), W - 130)}, ${PAD.t})`}>
              <rect width="120" height="38" rx="8" fill="#14121f" />
              <text x="10" y="16" fontSize="11" fill="#c7c4d6">{points[hover].label}</text>
              <text x="10" y="31" fontSize="13" fontWeight="600" fill="#fff">{points[hover].value == null ? "—" : format(points[hover].value!)}</text>
            </g>
          </g>
        )}
      </svg>
      <button className="text-xs text-ink-3 hover:text-ink mt-1" onClick={() => setTable((t) => !t)}>{table ? "Hide table" : "Show as table"}</button>
    </Frame>
  );
}

export function BarChart({ title, points, format = (v) => String(Math.round(v)) }: { title: string; points: Point[]; format?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const { y, top } = scale(points);
  const slot = (W - PAD.l - PAD.r) / Math.max(1, points.length);
  const bw = Math.min(28, slot - 6);
  return (
    <Frame title={title} points={points} format={format} showTable={table}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
        <Grid top={top} y={y} format={format} />
        {points.map((p, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          const v = p.value ?? 0;
          const h = Math.max(0, y(0) - y(v));
          return (
            <g key={p.label} onMouseEnter={() => setHover(i)}>
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
              {h > 0 && <path d={`M${cx - bw / 2},${y(0)} V${y(v) + 4} a4,4 0 0 1 4,-4 H${cx + bw / 2 - 4} a4,4 0 0 1 4,4 V${y(0)} Z`} fill="#4f46e5" opacity={hover == null || hover === i ? 1 : 0.55} />}
              {(points.length <= 10 || i % Math.ceil(points.length / 10) === 0) && <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#6e6a82">{p.label}</text>}
            </g>
          );
        })}
        {hover != null && (
          <g pointerEvents="none" transform={`translate(${Math.min(Math.max(PAD.l + slot * hover + slot / 2 - 60, PAD.l), W - 130)}, ${PAD.t})`}>
            <rect width="120" height="38" rx="8" fill="#14121f" />
            <text x="10" y="16" fontSize="11" fill="#c7c4d6">{points[hover].label}</text>
            <text x="10" y="31" fontSize="13" fontWeight="600" fill="#fff">{format(points[hover].value ?? 0)}</text>
          </g>
        )}
      </svg>
      <button className="text-xs text-ink-3 hover:text-ink mt-1" onClick={() => setTable((t) => !t)}>{table ? "Hide table" : "Show as table"}</button>
    </Frame>
  );
}
