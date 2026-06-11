/**
 * Trainer Intelligence Graph — collapsible SVG network view.
 *
 * Why hand-rolled SVG instead of recharts? Recharts has no first-class
 * network/force layout; its Treemap doesn't support per-tier coloring or
 * click-to-expand the way the spec asks for. D3 isn't in package.json
 * (only recharts is). Per the spec's third option, we render a pure SVG
 * tree layout — no new dependency.
 *
 * Interaction model: collapsed on load (trainer node only). Clicking the
 * trainer expands its batch nodes (animated). Clicking a batch opens an
 * HTML overlay panel listing that batch's candidates. Clicking the canvas
 * (or the collapse-all button) returns to the collapsed state.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Users, GraduationCap, CalendarCheck, TrendingUp, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Types — mirror the API contract from /api/trainers/:id/graph.
// ---------------------------------------------------------------------------

export interface TrainerGraphNode {
  id: string;
  type: "trainer" | "batch" | "candidate";
  label: string;
  value: number | null;
  status: string | null;
}
export interface TrainerGraphEdge {
  source: string;
  target: string;
}
export interface TrainerGraphSummary {
  total_batches: number;
  total_candidates: number;
  avg_attendance_pct: number;
  avg_score_pct: number;
}
export interface TrainerGraphData {
  trainer: { id: string; name: string };
  nodes: TrainerGraphNode[];
  edges: TrainerGraphEdge[];
  summary: TrainerGraphSummary;
}

// ---------------------------------------------------------------------------
// Color helpers.
// ---------------------------------------------------------------------------

function batchColor(status: string | null): string {
  // Running=green, Planned=orange, Completed=grey (case-insensitive).
  const s = (status ?? "").toLowerCase();
  if (s === "running") return "#22c55e";       // green
  if (s === "planned") return "#f97316";       // orange
  if (s === "completed") return "#94a3b8";     // grey
  return "#94a3b8";                            // grey fallback
}

function candidateDotColor(value: number | null): string {
  // >75% green, 50-75 orange, <50 red. Null/missing = slate.
  if (value == null) return "#94a3b8";         // slate-400
  if (value > 75) return "#22c55e";
  if (value >= 50) return "#f97316";
  return "#ef4444";
}

// ---------------------------------------------------------------------------
// Layout — trainer node fixed near top; batch nodes positioned dynamically
// when expanded (horizontal row for ≤4, radial semicircle for >4).
// ---------------------------------------------------------------------------

const VIEWBOX_W = 1000;
const VIEWBOX_H = 560;
const TRAINER_X = VIEWBOX_W / 2;
const TRAINER_Y = 140;
const TRAINER_R = 28;
const BATCH_R = 20;

interface PlacedBatch {
  node: TrainerGraphNode;
  id: string;
  x: number;
  y: number;
}

function buildBatchLayout(
  batches: TrainerGraphNode[],
  tx: number,
  ty: number,
): PlacedBatch[] {
  const n = batches.length;
  if (n === 0) return [];

  // Count ≤ 4 → horizontal row, 140px apart, centred on the trainer x.
  if (n <= 4) {
    const GAP = 140;
    const totalW = (n - 1) * GAP;
    const startX = tx - totalW / 2;
    const y = ty + 170;
    return batches.map((b, i) => ({ node: b, id: b.id, x: startX + i * GAP, y }));
  }

  // Count > 4 → radial arc (semicircle), growing radius until spacing ≥ 120px.
  const MIN_DIST = 120;
  function positions(radius: number): PlacedBatch[] {
    return batches.map((b, i) => {
      const angle = (i / (n - 1)) * Math.PI; // 0 → π
      return {
        node: b,
        id: b.id,
        x: tx + radius * Math.cos(angle),
        y: ty + 80 + radius * Math.sin(angle), // offset down so arc is below trainer
      };
    });
  }
  function minPairwise(ps: PlacedBatch[]): number {
    let m = Infinity;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        m = Math.min(m, Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y));
      }
    }
    return m;
  }
  let radius = 200;
  let pts = positions(radius);
  let guard = 0;
  while (minPairwise(pts) < MIN_DIST && guard < 50) {
    radius += 40;
    pts = positions(radius);
    guard++;
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Summary tiles row (4 metric KPIs above the graph). Unchanged.
// ---------------------------------------------------------------------------

function SummaryTile({
  icon: Icon, label, value, suffix,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  suffix?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-full bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold">
            {value}{suffix ?? ""}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component.
// ---------------------------------------------------------------------------

interface Props {
  data: TrainerGraphData;
}

const PANEL_W = 220;
const PANEL_H = 240;
const PANEL_GAP = 16;

export function TrainerGraph({ data }: Props) {
  const [expandedTrainer, setExpandedTrainer] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState<{ left: number; top: number } | null>(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768,
  );
  const [hovered, setHovered] = useState<{ x: number; y: number; node: TrainerGraphNode } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const trainer = useMemo(() => data.nodes.find((n) => n.type === "trainer"), [data]);
  const batches = useMemo(() => data.nodes.filter((n) => n.type === "batch"), [data]);
  const batchLayout = useMemo(
    () => buildBatchLayout(batches, TRAINER_X, TRAINER_Y),
    [batches],
  );

  // Map each batch id → its candidate nodes (parentage from API edges).
  const candidatesByBatch = useMemo(() => {
    const byId = new Map<string, TrainerGraphNode>();
    for (const n of data.nodes) byId.set(n.id, n);
    const m = new Map<string, TrainerGraphNode[]>();
    for (const e of data.edges) {
      if (e.source.startsWith("batch:") && e.target.startsWith("candidate:")) {
        const c = byId.get(e.target);
        if (!c) continue;
        const arr = m.get(e.source) ?? [];
        arr.push(c);
        m.set(e.source, arr);
      }
    }
    return m;
  }, [data]);

  const selectedCandidates = expandedBatch
    ? candidatesByBatch.get(expandedBatch) ?? []
    : [];
  const selectedBatchNode = expandedBatch
    ? batches.find((b) => b.id === expandedBatch) ?? null
    : null;

  // Desktop panel placement: pick the side with the most room, leave a 16px
  // gap, then shift away from / flip off any overlapping node positions.
  function computePanelPosition(batchId: string): { left: number; top: number } | null {
    const container = containerRef.current;
    const nodeEl = nodeRefs.current.get(batchId);
    if (!container || !nodeEl) return null;

    const cRect = container.getBoundingClientRect();
    const nRect = nodeEl.getBoundingClientRect();
    const nLeft = nRect.left - cRect.left;
    const nTop = nRect.top - cRect.top;
    const nRight = nLeft + nRect.width;
    const nBottom = nTop + nRect.height;
    const nCx = nLeft + nRect.width / 2;
    const nCy = nTop + nRect.height / 2;
    const cW = cRect.width;
    const cH = cRect.height;

    const space: Record<string, number> = {
      right: cW - nRight,
      left: nLeft,
      below: cH - nBottom,
      above: nTop,
    };
    let side = Object.keys(space).sort((a, b) => space[b] - space[a])[0];

    // Obstacles: every other node (trainer + other batches), container-relative.
    const obstacles: { left: number; top: number; right: number; bottom: number }[] = [];
    for (const [id, el] of nodeRefs.current) {
      if (id === batchId) continue;
      const r = el.getBoundingClientRect();
      obstacles.push({
        left: r.left - cRect.left,
        top: r.top - cRect.top,
        right: r.right - cRect.left,
        bottom: r.bottom - cRect.top,
      });
    }

    function rectFor(s: string, shift: number) {
      let left: number;
      let top: number;
      if (s === "right") { left = nRight + PANEL_GAP + shift; top = nCy - PANEL_H / 2; }
      else if (s === "left") { left = nLeft - PANEL_GAP - PANEL_W - shift; top = nCy - PANEL_H / 2; }
      else if (s === "below") { top = nBottom + PANEL_GAP + shift; left = nCx - PANEL_W / 2; }
      else { top = nTop - PANEL_GAP - PANEL_H - shift; left = nCx - PANEL_W / 2; }
      return { left, top, right: left + PANEL_W, bottom: top + PANEL_H };
    }
    function overlaps(r: { left: number; top: number; right: number; bottom: number }) {
      return obstacles.some(
        (o) => !(r.right < o.left || r.left > o.right || r.bottom < o.top || r.top > o.bottom),
      );
    }
    const opposite: Record<string, string> = { right: "left", left: "right", above: "below", below: "above" };

    let rect = rectFor(side, 0);
    let shifts = 0;
    while (overlaps(rect) && shifts < 3) {
      shifts++;
      rect = rectFor(side, shifts * 20);
    }
    if (overlaps(rect)) {
      side = opposite[side];
      rect = rectFor(side, 0);
    }

    // Clamp inside the container.
    const left = Math.max(8, Math.min(rect.left, cW - PANEL_W - 8));
    const top = Math.max(8, Math.min(rect.top, cH - PANEL_H - 8));
    return { left, top };
  }

  function collapseAll() {
    setExpandedTrainer(false);
    setExpandedBatch(null);
    setPanelPos(null);
    setHovered(null);
  }

  function handleTrainerClick(e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedTrainer((prev) => {
      const next = !prev;
      if (!next) {
        setExpandedBatch(null);
        setPanelPos(null);
      }
      return next;
    });
  }

  function handleBatchClick(e: React.MouseEvent, batchId: string) {
    e.stopPropagation();
    if (expandedBatch === batchId) {
      setExpandedBatch(null);
      setPanelPos(null);
      return;
    }
    setExpandedBatch(batchId);
    if (!isMobile) {
      setPanelPos(computePanelPosition(batchId));
    } else {
      setPanelPos(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* 4-tile summary row */}
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryTile icon={Users} label="Total batches" value={data.summary.total_batches} />
        <SummaryTile icon={GraduationCap} label="Total candidates" value={data.summary.total_candidates} />
        <SummaryTile icon={CalendarCheck} label="Avg attendance" value={data.summary.avg_attendance_pct.toFixed(1)} suffix="%" />
        <SummaryTile icon={TrendingUp} label="Avg score" value={data.summary.avg_score_pct.toFixed(1)} suffix="%" />
      </div>

      {/* Graph */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span><span className="inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: "#3b82f6" }} /> Trainer</span>
            <span><span className="inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: "#22c55e" }} /> Running batch</span>
            <span><span className="inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: "#f97316" }} /> Planned batch</span>
            <span><span className="inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: "#94a3b8" }} /> Completed batch</span>
            <span className="ml-3">Click the trainer to expand · click a batch for its candidates</span>
          </div>

          <div ref={containerRef} className="relative" onClick={collapseAll}>
            {/* Pulse keyframes for the active-batch glow ring. */}
            <style>{`@keyframes graphGlowPulse{0%,100%{opacity:.6}50%{opacity:.2}}`}</style>

            <svg viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`} className="w-full h-[420px]">
              {/* Connecting lines (trainer → each batch), drawn first. */}
              {batchLayout.map((b) => {
                const len = Math.hypot(b.x - TRAINER_X, b.y - TRAINER_Y);
                return (
                  <line
                    key={`line-${b.id}`}
                    x1={TRAINER_X}
                    y1={TRAINER_Y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    strokeDasharray={len}
                    style={{
                      strokeDashoffset: expandedTrainer ? 0 : len,
                      opacity: expandedTrainer ? 1 : 0,
                      transition: "stroke-dashoffset 300ms ease-out, opacity 300ms ease-out",
                      pointerEvents: "none",
                    }}
                  />
                );
              })}

              {/* Batch nodes — hidden (opacity 0) until trainer is expanded. */}
              {batchLayout.map((b) => {
                const active = expandedBatch === b.id;
                const dimmed = expandedBatch != null && !active;
                const opacity = !expandedTrainer ? 0 : dimmed ? 0.4 : 1;
                return (
                  <g
                    key={b.id}
                    ref={(el) => {
                      if (el) nodeRefs.current.set(b.id, el);
                      else nodeRefs.current.delete(b.id);
                    }}
                    style={{
                      cursor: "pointer",
                      opacity,
                      pointerEvents: expandedTrainer ? "auto" : "none",
                      transition: "opacity 300ms ease-out",
                    }}
                    onClick={(e) => handleBatchClick(e, b.id)}
                    onMouseEnter={() => setHovered({ x: b.x, y: b.y, node: b.node })}
                    onMouseLeave={() => setHovered((h) => (h?.node.id === b.id ? null : h))}
                  >
                    {/* Glow ring behind the active batch. */}
                    {active && (
                      <circle
                        cx={b.x}
                        cy={b.y}
                        r={BATCH_R + 6}
                        fill="none"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        style={{ animation: "graphGlowPulse 1.5s ease-in-out infinite" }}
                      />
                    )}
                    <circle cx={b.x} cy={b.y} r={BATCH_R} fill={batchColor(b.node.status)} stroke="white" strokeWidth={2} />
                    <text
                      x={b.x}
                      y={b.y + BATCH_R + 14}
                      textAnchor="middle"
                      fontSize={11}
                      fill="#0f172a"
                      style={{ pointerEvents: "none" }}
                    >
                      {b.node.label.length > 22 ? `${b.node.label.slice(0, 22)}…` : b.node.label}
                    </text>
                  </g>
                );
              })}

              {/* Trainer node — always visible, drawn on top. */}
              {trainer && (
                <g
                  ref={(el) => {
                    if (el) nodeRefs.current.set(trainer.id, el);
                    else nodeRefs.current.delete(trainer.id);
                  }}
                  style={{ cursor: "pointer", opacity: 1 }}
                  onClick={handleTrainerClick}
                  onMouseEnter={() => setHovered({ x: TRAINER_X, y: TRAINER_Y, node: trainer })}
                  onMouseLeave={() => setHovered((h) => (h?.node.id === trainer.id ? null : h))}
                >
                  <circle cx={TRAINER_X} cy={TRAINER_Y} r={TRAINER_R} fill="#3b82f6" stroke="white" strokeWidth={2} />
                  <text
                    x={TRAINER_X}
                    y={TRAINER_Y + TRAINER_R + 16}
                    textAnchor="middle"
                    fontSize={13}
                    fill="#0f172a"
                    style={{ pointerEvents: "none" }}
                  >
                    {trainer.label.length > 22 ? `${trainer.label.slice(0, 22)}…` : trainer.label}
                  </text>
                </g>
              )}
            </svg>

            {/* Collapse-all button — only while expanded. */}
            {expandedTrainer && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  collapseAll();
                }}
                className="absolute z-10 rounded-full border border-gray-200 bg-white p-1.5 shadow-sm hover:bg-gray-50 cursor-pointer"
                style={{ top: 12, right: 12 }}
                aria-label="Collapse graph"
              >
                <X className="h-4 w-4 text-gray-600" />
              </button>
            )}

            {/* Hover tooltip (trainer / batch). */}
            {hovered && (
              <div
                role="tooltip"
                className="pointer-events-none absolute rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-lg"
                style={{
                  left: `${(hovered.x / VIEWBOX_W) * 100}%`,
                  top: `${(hovered.y / VIEWBOX_H) * 100}%`,
                  transform: "translate(-50%, -130%)",
                  whiteSpace: "nowrap",
                }}
              >
                <div className="font-medium">{hovered.node.label}</div>
                <div className="text-muted-foreground">
                  {hovered.node.type === "trainer" && "Trainer"}
                  {hovered.node.type === "batch" && (
                    <>
                      {hovered.node.status ?? "—"}
                      {hovered.node.value != null && ` · attendance ${Number(hovered.node.value).toFixed(1)}%`}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Student list overlay — desktop side panel. */}
            {expandedBatch && !isMobile && panelPos && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  left: panelPos.left,
                  top: panelPos.top,
                  width: PANEL_W,
                  maxHeight: PANEL_H,
                  overflowY: "auto",
                  background: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: 12,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  zIndex: 20,
                }}
              >
                <StudentList batchLabel={selectedBatchNode?.label ?? ""} candidates={selectedCandidates} />
              </div>
            )}

            {/* Student list overlay — mobile bottom sheet. */}
            {expandedBatch && isMobile && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "fixed",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  maxHeight: "50vh",
                  overflowY: "auto",
                  background: "white",
                  borderRadius: "16px 16px 0 0",
                  padding: 12,
                  boxShadow: "0 -4px 12px rgba(0,0,0,0.1)",
                  zIndex: 50,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 4,
                    background: "#cbd5e1",
                    borderRadius: 2,
                    margin: "0 auto 8px",
                  }}
                />
                <StudentList batchLabel={selectedBatchNode?.label ?? ""} candidates={selectedCandidates} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student list panel content — one row per candidate.
// Candidate nodes carry only `value` (score %); the dot is coloured by score
// and the percentage shown is that same score (the only per-candidate metric
// the graph API returns — there is no per-candidate attendance field).
// ---------------------------------------------------------------------------

function StudentList({
  batchLabel, candidates,
}: {
  batchLabel: string;
  candidates: TrainerGraphNode[];
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-slate-700">
        {batchLabel || "Candidates"}
      </p>
      {candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">No candidates.</p>
      ) : (
        <ul className="space-y-1.5">
          {candidates.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-xs">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: candidateDotColor(c.value) }}
              />
              <span className="flex-1 truncate text-slate-800">{c.label}</span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {c.value != null ? `${Math.round(c.value)}%` : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
