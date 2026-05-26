/**
 * Feedback Intelligence Card (Feature 3) — visualises the
 * GPT-4.1-extracted themes + recommended actions for a batch.
 *
 * Reads cached analysis via GET /api/feedback-intelligence/analysis/:batchId.
 * The "Analyze Feedback" button POSTs to trigger a fresh analysis.
 * Handles 3 empty states: never-analysed, insufficient feedback, error.
 */

import { useEffect, useState, useCallback, type ReactElement } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, MessageSquare, Lightbulb, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types — mirror the API contract
// ---------------------------------------------------------------------------

interface Theme {
  theme: string;
  sentiment: "positive" | "neutral" | "negative" | string;
  evidence: string;
  frequency: "high" | "medium" | "low" | string;
}
interface Action {
  action: string;
  priority: "high" | "medium" | "low" | string;
  rationale: string;
}
export interface FeedbackIntelligence {
  id: string;
  batch_id: number;
  feedback_ids: number[];
  themes: Theme[];
  overall_sentiment: string | null;
  sentiment_score: number | null;
  recommended_actions: Action[];
  summary: string | null;
  analyzed_at: string | null;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function overallSentimentClass(s: string | null | undefined): string {
  const v = (s ?? "").toLowerCase();
  if (v === "positive") return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200";
  if (v === "negative") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200";
  if (v === "mixed") return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200";
  return "bg-muted text-foreground border-muted";
}

function themeSentimentClass(s: string | undefined): string {
  const v = (s ?? "").toLowerCase();
  if (v === "positive") return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (v === "negative") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (v === "neutral") return "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300";
  return "bg-muted text-foreground";
}

function frequencyClass(f: string | undefined): string {
  const v = (f ?? "").toLowerCase();
  if (v === "high") return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  if (v === "medium") return "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300";
  if (v === "low") return "bg-slate-100 text-slate-700";
  return "bg-muted text-foreground";
}

function priorityClass(p: string | undefined): string {
  const v = (p ?? "").toLowerCase();
  if (v === "high") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (v === "medium") return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  if (v === "low") return "bg-slate-100 text-slate-700";
  return "bg-muted text-foreground";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  batchId: string | number;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: FeedbackIntelligence }
  | { kind: "empty" }                   // never-analysed (GET 404)
  | { kind: "insufficient"; message: string; count: number }
  | { kind: "error"; message: string };

export function FeedbackIntelligenceCard({ batchId }: Props) {
  const { token } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [analyzing, setAnalyzing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setState({ kind: "loading" });
    try {
      const r = await fetch(`/api/feedback-intelligence/analysis/${batchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 404) {
        setState({ kind: "empty" });
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const d = (await r.json()) as FeedbackIntelligence;
      setState({ kind: "ready", data: d });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [batchId, token]);

  useEffect(() => { void load(); }, [load]);

  async function analyze() {
    if (!token) return;
    setAnalyzing(true);
    try {
      const r = await fetch(`/api/feedback-intelligence/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ batch_id: String(batchId) }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const d = await r.json();
      if (d?.error === "insufficient_feedback") {
        setState({ kind: "insufficient", message: d.message ?? "Add more feedback first.", count: d.feedback_count ?? 0 });
        return;
      }
      setState({ kind: "ready", data: d as FeedbackIntelligence });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setAnalyzing(false);
    }
  }

  // ----- header ------------------------------------------------------------
  const header = (
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Feedback Intelligence
          </CardTitle>
          <CardDescription>
            AI-extracted themes, sentiment, and recommended actions from this batch's feedback.
          </CardDescription>
        </div>
        <Button size="sm" onClick={analyze} disabled={analyzing}>
          <Sparkles className={cn("h-3.5 w-3.5 mr-1.5", analyzing && "animate-pulse")} />
          {analyzing ? "Analyzing…" : state.kind === "ready" ? "Re-analyze" : "Analyze Feedback"}
        </Button>
      </div>
    </CardHeader>
  );

  // ----- body --------------------------------------------------------------
  let body: ReactElement;
  if (state.kind === "loading") {
    body = (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  } else if (state.kind === "empty") {
    body = (
      <div className="text-center py-6 text-sm text-muted-foreground">
        No analysis yet for this batch. Click <span className="font-medium">Analyze Feedback</span> to run GPT-4.1.
      </div>
    );
  } else if (state.kind === "insufficient") {
    body = (
      <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm">
        <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
        <div>
          <p className="font-medium text-amber-900 dark:text-amber-200">Add at least 2 feedback entries to enable AI analysis.</p>
          <p className="text-xs text-amber-800/80 dark:text-amber-200/70">Currently {state.count} entry on file.</p>
        </div>
      </div>
    );
  } else if (state.kind === "error") {
    body = (
      <p className="text-sm text-destructive">{state.message}</p>
    );
  } else if (analyzing) {
    body = (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 animate-pulse text-primary" />
        Analyzing feedback with AI…
      </div>
    );
  } else {
    const d = state.data;
    body = (
      <div className="space-y-5">
        {/* Summary box */}
        {d.summary && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium leading-snug">{d.summary}</p>
          </div>
        )}

        {/* Overall sentiment row */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Overall</span>
          <Badge variant="outline" className={cn("font-semibold capitalize", overallSentimentClass(d.overall_sentiment))}>
            {d.overall_sentiment ?? "—"}
          </Badge>
          {d.sentiment_score != null && (
            <span className="font-mono text-xs text-muted-foreground">
              score: {d.sentiment_score.toFixed(2)}
            </span>
          )}
          {d.analyzed_at && (
            <span className="ml-auto text-xs text-muted-foreground">
              Analyzed {new Date(d.analyzed_at).toLocaleString()}
            </span>
          )}
        </div>

        {/* Themes */}
        {d.themes.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" /> Themes
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {d.themes.map((t, i) => (
                <div key={i} className="rounded-md border p-3 text-sm space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="font-medium">{t.theme}</p>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className={cn("capitalize", themeSentimentClass(t.sentiment))}>
                        {t.sentiment}
                      </Badge>
                      <Badge variant="secondary" className={cn("capitalize", frequencyClass(t.frequency))}>
                        {t.frequency} freq
                      </Badge>
                    </div>
                  </div>
                  {t.evidence && (
                    <p className="text-xs italic text-muted-foreground border-l-2 border-muted pl-2">
                      "{t.evidence}"
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommended actions */}
        {d.recommended_actions.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Lightbulb className="h-3.5 w-3.5" /> Recommended actions
            </div>
            <div className="space-y-2">
              {d.recommended_actions.map((a, i) => (
                <div key={i} className="flex items-start gap-3 rounded-md border p-3">
                  <Badge variant="secondary" className={cn("capitalize shrink-0", priorityClass(a.priority))}>
                    {a.priority}
                  </Badge>
                  <div className="text-sm flex-1 min-w-0">
                    <p className="font-medium leading-snug">{a.action}</p>
                    {a.rationale && (
                      <p className="text-xs text-muted-foreground mt-0.5">{a.rationale}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card>
      {header}
      <CardContent>{body}</CardContent>
    </Card>
  );
}
