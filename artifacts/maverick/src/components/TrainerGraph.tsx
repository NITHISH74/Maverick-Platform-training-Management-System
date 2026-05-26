/**
 * Trainer Intelligence Graph — 3-tier SVG network view.
 *
 * Why hand-rolled SVG instead of recharts? Recharts has no first-class
 * network/force layout; its Treemap doesn't support per-tier coloring or
 * click-to-filter the way the spec asks for. D3 isn't in package.json
 * (only recharts is). Per the spec's third option, we render a pure SVG
 * tree layout — no new dependency, all four interaction requirements met
 * (color-coded per tier, hover tooltip, click-to-highlight, summary tiles).
 */

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Users, GraduationCap, CalendarCheck, TrendingUp } from "lucide-react";

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
// Color helpers — match the spec exactly.
// ---------------------------------------------------------------------------

function batchColor(status: string | null): string {
  // Running=green, Completed=gray, Planned=amber (case-insensitive)
  const s = (status ?? "").toLowerCase();
  if (s === "running") return "#16a34a";       // green-600
  if (s === "completed") return "#6b7280";     // gray-500
  if (s === "planned") return "#f59e0b";       // amber-500
  return "#64748b";                            // slate-500 fallback
}

function candidateColor(value: number | null): string {
  // >75% green, 50-75 amber, <50 red. Null/missing = slate.
  if (value == null) return "#94a3b8";         // slate-400
  if (value > 75) return "#16a34a";
  if (value >= 50) return "#f59e0b";
  return "#dc2626";                            // red-600
}

// ---------------------------------------------------------------------------
// Layout — 3 horizontal tiers: trainer (top), batches (middle), candidates (bottom).
// We compute x positions evenly across the SVG viewbox per tier.
// ---------------------------------------------------------------------------

const VIEWBOX_W = 1000;
const VIEWBOX_H = 560;
const TRAINER_Y = 60;
const BATCH_Y = 240;
const CANDIDATE_Y = 460;

interface Placed {
  node: TrainerGraphNode;
  x: number;
  y: number;
  r: number; // radius
  batchId: string | null; // candidates → parent batch id for highlight filtering
}

function buildLayout(data: TrainerGraphData): Placed[] {
  const placed: Placed[] = [];
  const trainer = data.nodes.find((n) => n.type === "trainer");
  const batches = data.nodes.filter((n) => n.type === "batch");
  const candidates = data.nodes.filter((n) => n.type === "candidate");

  if (trainer) {
    placed.push({ node: trainer, x: VIEWBOX_W / 2, y: TRAINER_Y, r: 28, batchId: null });
  }

  const batchGap = batches.length > 0 ? VIEWBOX_W / (batches.length + 1) : 0;
  batches.forEach((b, i) => {
    placed.push({ node: b, x: batchGap * (i + 1), y: BATCH_Y, r: 20, batchId: b.id });
  });

  // For each batch, lay its candidates evenly under it.
  // Edges from API tell us batch→candidate parentage.
  const parentByCandidate = new Map<string, string>();
  for (const e of data.edges) {
    if (e.source.startsWith("batch:") && e.target.startsWith("candidate:")) {
      parentByCandidate.set(e.target, e.source);
    }
  }

  const candsByBatch = new Map<string, TrainerGraphNode[]>();
  for (const c of candidates) {
    const parent = parentByCandidate.get(c.id) ?? "orphan";
    const arr = candsByBatch.get(parent) ?? [];
    arr.push(c);
    candsByBatch.set(parent, arr);
  }

  for (const b of batches) {
    const cs = candsByBatch.get(b.id) ?? [];
    if (cs.length === 0) continue;
    const placedBatch = placed.find((p) => p.node.id === b.id);
    if (!placedBatch) continue;
    // Candidates fan out under the batch — width 200px around the batch x.
    const span = Math.max(160, cs.length * 28);
    const gap = span / Math.max(cs.length, 1);
    const startX = placedBatch.x - span / 2 + gap / 2;
    cs.forEach((c, i) => {
      placed.push({ node: c, x: startX + gap * i, y: CANDIDATE_Y, r: 11, batchId: b.id });
    });
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Summary tiles row (4 metric KPIs above the graph).
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

export function TrainerGraph({ data }: Props) {
  const placed = useMemo(() => buildLayout(data), [data]);
  const [hovered, setHovered] = useState<Placed | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);

  // For the click-to-highlight: when a batch is selected, candidates not under
  // that batch are dimmed.
  function nodeOpacity(p: Placed): number {
    if (!selectedBatch) return 1;
    if (p.node.type === "trainer") return 1;
    if (p.node.type === "batch") return p.node.id === selectedBatch ? 1 : 0.25;
    // candidate
    return p.batchId === selectedBatch ? 1 : 0.15;
  }
  function edgeOpacity(e: TrainerGraphEdge): number {
    if (!selectedBatch) return 0.5;
    if (e.source === selectedBatch || e.target === selectedBatch) return 0.9;
    // Candidate edges under selected batch
    if (e.source === selectedBatch && e.target.startsWith("candidate:")) return 0.9;
    return 0.08;
  }

  // Resolve x/y by id for edge drawing.
  const positionById = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const p of placed) m.set(p.node.id, { x: p.x, y: p.y });
    return m;
  }, [placed]);

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
            <span><span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-600 align-middle" /> Trainer</span>
            <span><span className="inline-block h-2.5 w-2.5 rounded-full bg-green-600 align-middle" /> Running batch</span>
            <span><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500 align-middle" /> Planned batch</span>
            <span><span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-500 align-middle" /> Completed batch</span>
            <span className="ml-3"><span className="inline-block h-2.5 w-2.5 rounded-full bg-green-600 align-middle" /> Candidate &gt;75%</span>
            <span><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500 align-middle" /> 50–75%</span>
            <span><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600 align-middle" /> &lt;50%</span>
            {selectedBatch && (
              <button
                type="button"
                onClick={() => setSelectedBatch(null)}
                className="ml-auto rounded border bg-background px-2 py-0.5 text-xs hover:bg-muted"
              >
                Clear selection
              </button>
            )}
          </div>

          <div className="relative">
            <svg viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`} className="w-full h-[420px]">
              {/* Edges first so nodes draw on top. */}
              {data.edges.map((e, i) => {
                const a = positionById.get(e.source);
                const b = positionById.get(e.target);
                if (!a || !b) return null;
                return (
                  <line
                    key={i}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke="#cbd5e1" strokeWidth={1.2}
                    style={{ opacity: edgeOpacity(e), transition: "opacity 120ms" }}
                  />
                );
              })}
              {/* Nodes */}
              {placed.map((p) => {
                let fill = "#2563eb"; // trainer = blue-600
                if (p.node.type === "batch") fill = batchColor(p.node.status);
                else if (p.node.type === "candidate") fill = candidateColor(p.node.value);
                return (
                  <g
                    key={p.node.id}
                    style={{ cursor: p.node.type === "batch" ? "pointer" : "default", opacity: nodeOpacity(p), transition: "opacity 120ms" }}
                    onMouseEnter={() => setHovered(p)}
                    onMouseLeave={() => setHovered((h) => (h?.node.id === p.node.id ? null : h))}
                    onClick={() => {
                      if (p.node.type === "batch") {
                        setSelectedBatch((cur) => (cur === p.node.id ? null : p.node.id));
                      }
                    }}
                  >
                    <circle cx={p.x} cy={p.y} r={p.r} fill={fill} stroke="white" strokeWidth={2} />
                    {p.node.type !== "candidate" && (
                      <text
                        x={p.x}
                        y={p.y + p.r + 14}
                        textAnchor="middle"
                        fontSize={p.node.type === "trainer" ? 13 : 11}
                        fill="#0f172a"
                        style={{ pointerEvents: "none" }}
                      >
                        {p.node.label.length > 22 ? `${p.node.label.slice(0, 22)}…` : p.node.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Hover tooltip */}
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
                  {hovered.node.type === "candidate" && (
                    <>
                      {hovered.node.status ?? "—"}
                      {hovered.node.value != null
                        ? ` · score ${Number(hovered.node.value).toFixed(1)}%`
                        : " · no scores"}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {selectedBatch && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing candidates for the selected batch only. Click the batch again or use “Clear selection”.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
