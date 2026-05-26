import { useRoute, Link } from "wouter";
import { useBatchRiskDetail } from "@/lib/monitoring-api";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, TrendingDown, TrendingUp, Users } from "lucide-react";
import { AlertCard } from "@/components/monitoring/AlertCard";
import { RiskBadge } from "@/components/monitoring/RiskBadge";

/**
 * BatchRiskDetail — drill-down for one batch.
 *
 * Renders the batch's full alert history (open + closed) plus its current
 * health metrics. Reachable from /monitoring/batch/:batchId, which is what
 * the BatchRiskCard link emits.
 */
export default function BatchRiskDetail() {
  const [, params] = useRoute<{ batchId: string }>("/monitoring/batch/:batchId");
  const batchId = params?.batchId ? Number(params.batchId) : null;

  const { data, isLoading, error } = useBatchRiskDetail(batchId);

  if (!batchId) {
    return (
      <Layout>
        <p className="text-muted-foreground">No batch selected.</p>
      </Layout>
    );
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      </Layout>
    );
  }

  if (error || !data) {
    return (
      <Layout>
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            <p>Couldn't load batch risk detail.</p>
            <Link href="/monitoring">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to monitoring
              </Button>
            </Link>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  const { batch, summary, alerts } = data;
  const openAlerts = alerts.filter((a) => a.status === "open");
  const closedAlerts = alerts.filter((a) => a.status !== "open");

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <Link href="/monitoring">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
                {batch.batchCode}
                {summary && <RiskBadge level={summary.riskLevel} />}
              </h1>
              <p className="text-muted-foreground">{batch.name} · {batch.program}</p>
            </div>
          </div>
          <Link href={`/batches/${batch.id}`}>
            <Button variant="outline" size="sm">View batch details</Button>
          </Link>
        </div>

        {/* Metric tiles */}
        {summary && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Active candidates</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  {summary.activeCandidates}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Attendance (14d)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.attendancePct.toFixed(1)}%</div>
                <Progress value={summary.attendancePct} className="h-1.5 mt-2" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Drop vs prior week</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-2">
                  {summary.attendanceDropPct > 0
                    ? <TrendingDown className="h-5 w-5 text-orange-500" />
                    : <TrendingUp className="h-5 w-5 text-green-500" />}
                  {summary.attendanceDropPct.toFixed(1)}%
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Clearance rate</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.clearancePct.toFixed(1)}%</div>
                <Progress value={summary.clearancePct} className="h-1.5 mt-2" />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Open alerts */}
        <Card>
          <CardHeader>
            <CardTitle>Open alerts ({openAlerts.length})</CardTitle>
            <CardDescription>Take action or acknowledge.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {openAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No open alerts. This batch is clear.</p>
            ) : (
              openAlerts.map((a) => <AlertCard key={a.id} alert={a} />)
            )}
          </CardContent>
        </Card>

        {/* Closed alerts */}
        {closedAlerts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Closed alerts ({closedAlerts.length})</CardTitle>
              <CardDescription>Acknowledged, resolved, or dismissed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {closedAlerts.map((a) => <AlertCard key={a.id} alert={a} compact />)}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
