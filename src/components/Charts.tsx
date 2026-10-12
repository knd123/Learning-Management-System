import { CheckCircle2, CircleAlert, CircleDot, Table2, LineChart } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { monthLabel, shortMonth } from '../lib/format.ts';
import { Badge } from './ui.tsx';

// Categorical order from the validated reference palette (light mode). Colors
// follow the series (class), never its rank, so a class keeps its color.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const SURFACE = '#fcfcfb';
const GRID = '#e1e0d9';
const AXIS = '#c3c2b7';
const MUTED = '#7b847f';

export interface TrendSeries {
  id: string;
  name: string;
  colorIndex: number;
  points: Array<{ month: string; score: number }>;
}

/** Monthly quiz scores (0–100%) per class, with hover crosshair and a table view. */
export function ScoreTrendChart({ series, title = 'Monthly quiz scores' }: { series: TrendSeries[]; title?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const months = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.month)))].sort(), [series]);
  // Draw at the container's real pixel width so text and marks keep their size.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);

  const H = 220;
  const m = { l: 40, r: 20, t: 16, b: 30 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const x = (i: number) => m.l + (months.length === 1 ? iw / 2 : (i * iw) / (months.length - 1));
  const y = (v: number) => m.t + ih - (v / 100) * ih;
  const color = (s: TrendSeries) => SERIES[s.colorIndex % SERIES.length];

  if (!months.length) return null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * iw;
    const idx = months.length === 1 ? 0 : Math.round((px / iw) * (months.length - 1));
    setHover(Math.max(0, Math.min(months.length - 1, idx)));
  };

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-sm font-semibold text-ink">{title}</figcaption>
        <button onClick={() => setAsTable((t) => !t)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-sand-100">
          {asTable ? <LineChart className="size-3.5" /> : <Table2 className="size-3.5" />}
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" aria-label="Legend">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: color(s) }} aria-hidden />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-200 text-left text-xs text-ink-muted">
                <th className="py-2 pr-4 font-semibold">Month</th>
                {series.map((s) => (
                  <th key={s.id} className="py-2 pr-4 font-semibold">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((mo) => (
                <tr key={mo} className="border-b border-sand-100 tabular-nums">
                  <td className="py-2 pr-4">{monthLabel(mo)}</td>
                  {series.map((s) => {
                    const p = s.points.find((pt) => pt.month === mo);
                    return (
                      <td key={s.id} className="py-2 pr-4">
                        {p ? `${p.score}%` : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="relative overflow-hidden rounded-xl" style={{ background: SURFACE }}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={`${title}: ${series.map((s) => `${s.name} ${s.points.map((p) => `${monthLabel(p.month)} ${p.score}%`).join(', ')}`).join('; ')}`}>
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={v}>
                <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? AXIS : GRID} strokeWidth={1} />
                <text x={m.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill={MUTED} className="tabular-nums">
                  {v}%
                </text>
              </g>
            ))}
            {months.map((mo, i) => (
              <text key={mo} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={MUTED}>
                {shortMonth(mo)}
              </text>
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke={AXIS} strokeWidth={1} />}
            {series.map((s) => {
              const pts = months.map((mo, i) => ({ i, p: s.points.find((pt) => pt.month === mo) })).filter((d) => d.p);
              const path = pts.map((d, k) => `${k ? 'L' : 'M'}${x(d.i)},${y(d.p!.score)}`).join(' ');
              const last = pts[pts.length - 1];
              return (
                <g key={s.id}>
                  <path d={path} fill="none" stroke={color(s)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {pts.map((d) => (
                    <circle key={d.i} cx={x(d.i)} cy={y(d.p!.score)} r={hover === d.i ? 5.5 : 4} fill={color(s)} stroke={SURFACE} strokeWidth={2} />
                  ))}
                  {series.length === 1 && last && (
                    <text x={x(last.i)} y={y(last.p!.score) - 12} textAnchor="middle" fontSize={12} fontWeight={600} fill="#1f2a2a">
                      {last.p!.score}%
                    </text>
                  )}
                </g>
              );
            })}
            <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border border-sand-200 bg-white px-3 py-2 text-xs shadow-lg"
              style={{ left: `${(x(hover) / W) * 100}%`, transform: x(hover) > W / 2 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}
            >
              <p className="mb-1 font-semibold text-ink">{monthLabel(months[hover])}</p>
              {series.map((s) => {
                const p = s.points.find((pt) => pt.month === months[hover]);
                return (
                  <p key={s.id} className="flex items-center justify-between gap-3 text-ink-soft">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block size-2 rounded-full" style={{ background: color(s) }} aria-hidden />
                      {s.name}
                    </span>
                    <span className="font-semibold tabular-nums text-ink">{p ? `${p.score}%` : '—'}</span>
                  </p>
                );
              })}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

export function masteryLevel(pct: number) {
  if (pct >= 80) return { label: 'Strong', tone: 'green' as const, Icon: CheckCircle2 };
  if (pct >= 50) return { label: 'Developing', tone: 'amber' as const, Icon: CircleDot };
  return { label: 'Needs practice', tone: 'red' as const, Icon: CircleAlert };
}

/** Skill-by-skill quiz results: one-color bars (length = % correct) plus a labelled level. */
export function TopicBars({ topics }: { topics: Array<{ topic: string; correct: number; total: number; pct: number }> }) {
  if (!topics.length) return <p className="text-sm text-ink-muted">Skill results appear after the first monthly quiz.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {topics.map((t) => {
        const level = masteryLevel(t.pct);
        return (
          <li key={t.topic} title={`${t.topic}: ${t.correct} of ${t.total} correct`}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-medium text-ink">{t.topic}</span>
              <Badge tone={level.tone}>
                <level.Icon className="size-3" aria-hidden /> {level.label}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-2.5 flex-1 rounded-r bg-sand-100">
                <div className="h-2.5 rounded-r" style={{ width: `${Math.max(t.pct, 2)}%`, background: SERIES[0] }} />
              </div>
              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-ink-soft">
                {t.pct}% · {t.correct}/{t.total}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
