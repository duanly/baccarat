/** 牌路渲染：珠盘路 + 大路（6 行折行/龙尾）+ 大眼仔 / 小路 / 曱甴路 + 问路 */
import { useEffect, useRef } from 'react';
import type { BigRoadCell, DerivedColor, Roadmap as RM, RoundSummary } from '../lib/protocol';

const ROWS = 6;
const RED = '#d62828';
const BLUE = '#1d5fd6';
const GREEN = '#2a9d4f';

interface Placed<T> { x: number; y: number; v: T }

/** 通用折行布局：每列从第 0 行向下，到底或撞到已占格子时向右延伸（龙尾） */
function layout<T>(cols: T[][]): { cells: Placed<T>[]; width: number } {
  const occ = new Set<string>();
  const cells: Placed<T>[] = [];
  let width = 0;
  cols.forEach((col, ci) => {
    let x = ci, y = 0;
    col.forEach((v, i) => {
      if (i > 0) {
        if (y + 1 < ROWS && !occ.has(`${x},${y + 1}`)) y++;
        else x++;
      }
      occ.add(`${x},${y}`);
      cells.push({ x, y, v });
      width = Math.max(width, x + 1);
    });
  });
  return { cells, width };
}

function Grid({ width, cell, children, minCols }: { width: number; cell: number; children: React.ReactNode; minCols: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const cols = Math.max(width, minCols);
  useEffect(() => { const el = ref.current; if (el) el.scrollLeft = Math.max(0, width * cell - el.clientWidth); }, [width, cell]);
  return (
    <div className="road-scroll" ref={ref}>
      <svg width={cols * cell} height={ROWS * cell} className="road-svg">
        <defs>
          <pattern id={`g${cell}`} width={cell} height={cell} patternUnits="userSpaceOnUse">
            <path d={`M ${cell} 0 L 0 0 0 ${cell}`} fill="none" stroke="var(--grid)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#g${cell})`} />
        {children}
      </svg>
    </div>
  );
}

export function BeadPlate({ bead, cell = 22 }: { bead: RoundSummary[]; cell?: number }) {
  const cols = Math.ceil(bead.length / ROWS);
  return (
    <Grid width={cols} cell={cell} minCols={12}>
      {bead.map((r, i) => {
        const x = Math.floor(i / ROWS), y = i % ROWS, c = cell;
        const color = r.outcome === 'banker' ? RED : r.outcome === 'player' ? BLUE : GREEN;
        const label = r.outcome === 'banker' ? '庄' : r.outcome === 'player' ? '闲' : '和';
        return (
          <g key={i} transform={`translate(${x * c + c / 2},${y * c + c / 2})`}>
            <circle r={c * 0.42} fill={color} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={c * 0.5} fill="#fff">{label}</text>
            {r.bankerPair && <circle cx={c * 0.3} cy={-c * 0.3} r={c * 0.12} fill={RED} stroke="#fff" strokeWidth="1" />}
            {r.playerPair && <circle cx={-c * 0.3} cy={c * 0.3} r={c * 0.12} fill={BLUE} stroke="#fff" strokeWidth="1" />}
          </g>
        );
      })}
    </Grid>
  );
}

export function BigRoad({ cols, leadingTies, cell = 22, minCols = 20 }: { cols: BigRoadCell[][]; leadingTies: number; cell?: number; minCols?: number }) {
  const { cells, width } = layout(cols);
  const c = cell;
  return (
    <Grid width={width} cell={c} minCols={minCols}>
      {leadingTies > 0 && cells.length === 0 && (
        <g transform={`translate(${c / 2},${c / 2})`}>
          <line x1={-c * 0.35} y1={c * 0.35} x2={c * 0.35} y2={-c * 0.35} stroke={GREEN} strokeWidth={2} />
          <text x={c * 0.22} y={-c * 0.2} fontSize={c * 0.35} fill={GREEN}>{leadingTies}</text>
        </g>
      )}
      {cells.map(({ x, y, v }, i) => {
        const color = v.outcome === 'banker' ? RED : BLUE;
        return (
          <g key={i} transform={`translate(${x * c + c / 2},${y * c + c / 2})`}>
            <circle r={c * 0.36} fill="none" stroke={color} strokeWidth={2.2} />
            {v.ties > 0 && <line x1={-c * 0.36} y1={c * 0.36} x2={c * 0.36} y2={-c * 0.36} stroke={GREEN} strokeWidth={2} />}
            {v.ties > 1 && <text x={c * 0.18} y={-c * 0.15} fontSize={c * 0.32} fill={GREEN}>{v.ties}</text>}
            {v.bankerPair && <circle cx={-c * 0.3} cy={-c * 0.3} r={c * 0.11} fill={RED} stroke="#fff" strokeWidth="1" />}
            {v.playerPair && <circle cx={c * 0.3} cy={c * 0.3} r={c * 0.11} fill={BLUE} stroke="#fff" strokeWidth="1" />}
          </g>
        );
      })}
    </Grid>
  );
}

type Style = 'ring' | 'dot' | 'slash';

export function DerivedRoad({ cols, style, cell = 12, minCols = 30 }: { cols: DerivedColor[][]; style: Style; cell?: number; minCols?: number }) {
  const { cells, width } = layout(cols);
  const c = cell;
  return (
    <Grid width={width} cell={c} minCols={minCols}>
      {cells.map(({ x, y, v }, i) => {
        const color = v === 'red' ? RED : BLUE;
        const cx = x * c + c / 2, cy = y * c + c / 2;
        if (style === 'ring') return <circle key={i} cx={cx} cy={cy} r={c * 0.34} fill="none" stroke={color} strokeWidth={1.8} />;
        if (style === 'dot') return <circle key={i} cx={cx} cy={cy} r={c * 0.34} fill={color} />;
        return <line key={i} x1={cx - c * 0.32} y1={cy + c * 0.32} x2={cx + c * 0.32} y2={cy - c * 0.32} stroke={color} strokeWidth={2} />;
      })}
    </Grid>
  );
}

function Pred({ c }: { c: DerivedColor | null }) {
  return <span className="pred-dot" style={{ background: c === 'red' ? RED : c === 'blue' ? BLUE : 'transparent', borderColor: c ? 'transparent' : 'var(--grid)' }} />;
}

export function RoadmapPanel({ rm, compact }: { rm: RM; compact?: boolean }) {
  const s = rm.stats;
  const big = compact ? 12 : 22;
  const small = compact ? 7 : 12;
  return (
    <div className={`roadmap ${compact ? 'compact' : ''}`}>
      <div className="road-row">
        <div className="road-block bead"><BeadPlate bead={rm.bead} cell={big} /></div>
        <div className="road-block big"><BigRoad cols={rm.bigRoad} leadingTies={rm.leadingTies} cell={big} /></div>
      </div>
      <div className="road-row derived">
        <div className="road-block"><DerivedRoad cols={rm.bigEye} style="ring" cell={small} /></div>
        <div className="road-block"><DerivedRoad cols={rm.small} style="dot" cell={small} /></div>
        <div className="road-block"><DerivedRoad cols={rm.cockroach} style="slash" cell={small} /></div>
      </div>
      <div className="road-stats">
        <span>局 {s.rounds}</span>
        <span style={{ color: RED }}>庄 {s.banker}</span>
        <span style={{ color: BLUE }}>闲 {s.player}</span>
        <span style={{ color: GREEN }}>和 {s.tie}</span>
        <span style={{ color: RED }}>庄对 {s.bankerPair}</span>
        <span style={{ color: BLUE }}>闲对 {s.playerPair}</span>
        <span className="pred">
          <b style={{ color: RED }}>庄问路</b>
          <Pred c={rm.prediction.banker.bigEye} /><Pred c={rm.prediction.banker.small} /><Pred c={rm.prediction.banker.cockroach} />
          <b style={{ color: BLUE }}>闲问路</b>
          <Pred c={rm.prediction.player.bigEye} /><Pred c={rm.prediction.player.small} /><Pred c={rm.prediction.player.cockroach} />
        </span>
      </div>
    </div>
  );
}
