/**
 * Trainer detail page.
 *
 * Did not exist previously — the codebase had Batch / Candidate detail
 * pages, but trainers were only managed from /users. This page is the
 * canonical landing spot for the Trainer Intelligence Graph (F1) and
 * Trainer Score Card (F2).
 *
 * Route: /trainers/:id  — admin/coordinator only (trainers don't drill
 * into other trainers' analytics). Wired in App.tsx.
 */

import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BrainCircuit, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { TrainerGraph, type TrainerGraphData } from "@/components/TrainerGraph";
import { TrainerScoreCard } from "@/components/TrainerScoreCard";

export default function TrainerDetail() {
  const params = useParams<{ id: string }>();
  const trainerId = params.id;
  const { token } = useAuth();
  const [graph, setGraph] = useState<TrainerGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trainerId || !token) return;
    setLoading(true);
    setError(null);
    fetch(`/api/trainers/${trainerId}/graph`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return r.json() as Promise<TrainerGraphData>;
      })
      .then((d) => setGraph(d))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [trainerId, token]);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          {/* wouter v3 <Link> renders the <a> itself — don't nest another. */}
          <Link href="/users" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to users
          </Link>
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {graph?.trainer.name ?? "Trainer"}
          </h1>
          <p className="text-muted-foreground">Trainer profile · ID {trainerId}</p>
        </div>

        {/* --- AI effectiveness score (Feature 2) — sits ABOVE the graph per spec --- */}
        {trainerId && graph && graph.nodes.some((n) => n.type === "batch") && (
          <TrainerScoreSection trainerId={trainerId} graph={graph} />
        )}

        {/* --- Intelligence Graph section heading + visualization (Feature 1) --- */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <BrainCircuit className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Intelligence Graph</h2>
          </div>

          {loading && (
            <Card>
              <CardContent className="p-6 space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
          )}
          {error && !loading && (
            <Card>
              <CardContent className="p-6 text-sm text-destructive">
                Failed to load: {error}
              </CardContent>
            </Card>
          )}
          {graph && !loading && !error && <TrainerGraph data={graph} />}
        </div>
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Trainer Score section. A trainer typically owns multiple batches; we show
// one TrainerScoreCard at a time and let the user switch between batches
// via the row of toggle buttons. First batch is selected by default.
// ---------------------------------------------------------------------------

function TrainerScoreSection({ trainerId, graph }: { trainerId: string; graph: TrainerGraphData }) {
  const batches = graph.nodes.filter((n) => n.type === "batch");
  const [activeBatchId, setActiveBatchId] = useState<string>(() =>
    batches[0]?.id.replace(/^batch:/, "") ?? "",
  );

  if (batches.length === 0 || !activeBatchId) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          AI effectiveness score
        </CardTitle>
        {batches.length > 1 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {batches.map((b) => {
              const bid = b.id.replace(/^batch:/, "");
              const active = bid === activeBatchId;
              return (
                <Button
                  key={b.id}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => setActiveBatchId(bid)}
                >
                  {b.label}
                </Button>
              );
            })}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <TrainerScoreCard trainerId={trainerId} batchId={activeBatchId} />
      </CardContent>
    </Card>
  );
}
