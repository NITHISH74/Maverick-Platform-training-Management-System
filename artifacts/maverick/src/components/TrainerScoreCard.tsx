/**
 * Trainer Score Card — visualises the AI-generated effectiveness score
 * persisted in trainer_scores. On first render it tries GET; if there's
 * nothing yet (404), it shows an empty state with the "Generate score"
 * action. The "Re-score" button triggers a fresh POST.
 *
 * Uses recharts (already in package.json) for the composite donut chart.
 */

import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Sparkles, ThumbsUp, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export interface TrainerScore {
  id: string;
  trainer_id: number;
  batch_id: number;
  attendance_score: number | null;
  assessment_score: number | null;
  feedback_score: number | null;
  composite_score: number | null;
  reasoning: string | null;
  strengths: string[];
  improvements: string[];
  generated_at: string | null;
}

interface Props {
  trainerId: string;
  batchId: string;
}

// Color the donut by composite score band (matches the graph's candidate bands).
function bandColor(v: number | null): string {
  if (v == null) return "#94a3b8"; // slate-400
  if (v > 75) return "#16a34a";    // green-600
  if (v >= 50) return "#f59e0b";   // amber-500
  return "#dc2626";                // red-600
}

function SubScoreBar({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const color = bandColor(value);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-muted-foreground">
          {value == null ? "—" : `${value.toFixed(0)}/100`}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full transition-all"
          style={{ width: `${Math.max(0, Math.min(100, v))}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function TrainerScoreCard({ trainerId, batchId }: Props) {
  const { token } = useAuth();
  const [score, setScore] = useState<TrainerScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [rescoring, setRescoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notScored, setNotScored] = useState(false);

  // Initial fetch — distinguish "no score yet" (404) from real errors.
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setNotScored(false);
    fetch(`/api/trainer-scoring/score/${trainerId}/${batchId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (r.status === 404) {
          setNotScored(true);
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return (await r.json()) as TrainerScore;
      })
      .then((d) => { if (d) setScore(d); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [trainerId, batchId, token]);

  async function generateOrRescore() {
    if (!token) return;
    setRescoring(true);
    setError(null);
    try {
      const r = await fetch(`/api/trainer-scoring/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ trainer_id: trainerId, batch_id: batchId }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const d = (await r.json()) as TrainerScore;
      setScore(d);
      setNotScored(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRescoring(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (notScored && !score) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="text-sm text-muted-foreground">
            No AI score yet for this trainer / batch.
          </div>
          <Button onClick={generateOrRescore} disabled={rescoring}>
            <Sparkles className={`h-4 w-4 mr-2 ${rescoring ? "animate-pulse" : ""}`} />
            {rescoring ? "Scoring…" : "Generate score"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!score) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {error ?? "Failed to load score."}
          <Button size="sm" variant="outline" className="ml-3" onClick={generateOrRescore} disabled={rescoring}>
            <RefreshCw className={`h-3 w-3 mr-1 ${rescoring ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const composite = score.composite_score ?? 0;
  const donutData = [
    { name: "score", value: composite },
    { name: "rest", value: Math.max(0, 100 - composite) },
  ];
  const donutColors = [bandColor(score.composite_score), "#e5e7eb"];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {score.generated_at && (
            <>Last scored {new Date(score.generated_at).toLocaleString()}</>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={generateOrRescore} disabled={rescoring}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${rescoring ? "animate-spin" : ""}`} />
          {rescoring ? "Re-scoring…" : "Re-score"}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-[200px_1fr] items-center">
        {/* Composite donut */}
        <div className="relative h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={donutData}
                dataKey="value"
                innerRadius={60}
                outerRadius={80}
                startAngle={90}
                endAngle={-270}
                isAnimationActive
              >
                {donutData.map((_, i) => <Cell key={i} fill={donutColors[i]} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-3xl font-bold">{composite.toFixed(0)}</div>
            <div className="text-xs text-muted-foreground">composite</div>
          </div>
        </div>

        {/* Sub-scores as horizontal bars */}
        <div className="space-y-3">
          <SubScoreBar label="Attendance (30%)" value={score.attendance_score} />
          <SubScoreBar label="Assessment (40%)" value={score.assessment_score} />
          <SubScoreBar label="Feedback (30%)"   value={score.feedback_score} />
        </div>
      </div>

      {score.reasoning && (
        <p className="text-sm italic text-muted-foreground border-l-2 border-muted pl-3">
          {score.reasoning}
        </p>
      )}

      {(score.strengths.length > 0 || score.improvements.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <ThumbsUp className="h-3.5 w-3.5 text-green-600" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Strengths</span>
            </div>
            <ul className="space-y-1 text-sm list-disc list-inside marker:text-green-600">
              {score.strengths.map((s, i) => <li key={i}>{s}</li>)}
              {score.strengths.length === 0 && <li className="text-muted-foreground italic list-none">None listed.</li>}
            </ul>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Improvements</span>
            </div>
            <ul className="space-y-1 text-sm list-disc list-inside marker:text-amber-600">
              {score.improvements.map((s, i) => <li key={i}>{s}</li>)}
              {score.improvements.length === 0 && <li className="text-muted-foreground italic list-none">None listed.</li>}
            </ul>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
