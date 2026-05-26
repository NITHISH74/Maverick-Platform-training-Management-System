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
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, BrainCircuit } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { TrainerGraph, type TrainerGraphData } from "@/components/TrainerGraph";
// TrainerScoreCard is wired in Feature 2 (AI Trainer Scoring Engine).

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
          <Link href="/users">
            <a className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back to users
            </a>
          </Link>
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {graph?.trainer.name ?? "Trainer"}
          </h1>
          <p className="text-muted-foreground">Trainer profile · ID {trainerId}</p>
        </div>

        {/* AI Trainer Score Card slot — wired in Feature 2. */}

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

// Feature 2 (TrainerScoreCardSection) will be added in the next step.
