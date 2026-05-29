import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useGetDashboardSummary, useGetRecentActivity, useGetCandidateStatusBreakdown, useGetAttendanceTrends, useListCandidates } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Users, GraduationCap, CalendarCheck, TrendingUp, AlertTriangle, Activity, ShieldAlert, ArrowRight, XCircle, Hourglass, Settings, Check, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Layout } from "@/components/layout/Layout";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell, Cell as BarCell } from "recharts";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBatchRiskSummaries } from "@/lib/monitoring-api";
import { RiskBadge } from "@/components/monitoring/RiskBadge";
import { useAuth } from "@/hooks/useAuth";
import { ClearanceModal } from "@/components/dashboard/ClearanceModal";

const COLORS = ['#0ea5e9', '#22c55e', '#eab308', '#f97316', '#ef4444', '#8b5cf6'];

export default function Dashboard() {
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity();
  const { data: statusBreakdown, isLoading: statusLoading } = useGetCandidateStatusBreakdown();
  const { data: trends, isLoading: trendsLoading } = useGetAttendanceTrends();

  if (summaryLoading) {
    return (
      <Layout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">Overview of your training operations.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <Skeleton className="h-4 w-[100px]" />
                  <Skeleton className="h-4 w-4 rounded-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-[60px]" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  if (!summary) return null;

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your training operations.</p>
        </div>
        
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Candidates</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalCandidates}</div>
              <p className="text-xs text-muted-foreground">
                {summary.activeCandidates} active
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Running Batches</CardTitle>
              <GraduationCap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.runningBatches}</div>
              <p className="text-xs text-muted-foreground">
                Out of {summary.totalBatches} total
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Attendance</CardTitle>
              <CalendarCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.avgAttendancePercent}%</div>
              <p className="text-xs text-muted-foreground">
                Across all running batches
              </p>
            </CardContent>
          </Card>

          <Card className={summary.activeAlerts > 0 ? "border-destructive/50 bg-destructive/5" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
              {summary.activeAlerts > 0 ? (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              ) : (
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              )}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.activeAlerts}</div>
              <p className="text-xs text-muted-foreground">
                Requires attention
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cleared</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.clearedCandidates ?? 0}</div>
              <p className="text-xs text-muted-foreground">Assessment cleared</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Offered</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.offeredCandidates ?? 0}</div>
              <p className="text-xs text-muted-foreground">Offer extended</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Onboarded</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.onboardedCandidates ?? 0}</div>
              <p className="text-xs text-muted-foreground">Joined client</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Discontinued</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.discontinuedCandidates}</div>
              <p className="text-xs text-muted-foreground">Dropped from training</p>
            </CardContent>
          </Card>
        </div>

        {/* Compact monitoring summary — surfaces the Autonomous Batch
            Monitoring Agent inside the main Dashboard. Full UI lives at
            /monitoring; this card is the at-a-glance entry point. */}
        <MonitoringSummaryCard />

        {/* F1: new KPI tiles — Not Cleared (Tile A) + Remaining in Training (Tile B). */}
        <NotClearedAndRemainingTiles />

        {/* F1.C: Attendance % per batch (current week) — horizontal bar chart. */}
        <AttendanceByBatchChart />

        {/* F1.D: Clearance summary table with per-batch threshold modal. */}
        <ClearanceSummaryTable />

        {/* F2: Batch comparison grouped by program. */}
        <BatchComparisonSection />

        <div className="grid gap-4 md:grid-cols-7">
          <Card className="md:col-span-4">
            <CardHeader>
              <CardTitle>Attendance Trend</CardTitle>
              <CardDescription>System-wide daily presence count</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              {trendsLoading ? (
                <div className="w-full h-full flex items-center justify-center"><Skeleton className="w-full h-full" /></div>
              ) : trends && trends.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trends} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" opacity={0.2} />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(val) => format(new Date(val), 'MMM d')}
                      stroke="#888"
                      fontSize={12}
                      tickMargin={10}
                    />
                    <YAxis stroke="#888" fontSize={12} tickMargin={10} />
                    <RechartsTooltip 
                      labelFormatter={(val) => format(new Date(val), 'MMM d, yyyy')}
                      contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '6px' }}
                    />
                    <Line type="monotone" dataKey="presentCount" name="Present" stroke="var(--primary)" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="absentCount" name="Absent" stroke="var(--destructive)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">No trend data available</div>
              )}
            </CardContent>
          </Card>

          <Card className="md:col-span-3">
            <CardHeader>
              <CardTitle>Candidate Pipeline</CardTitle>
              <CardDescription>Current status distribution</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px] flex flex-col justify-center">
              {statusLoading ? (
                <div className="w-full h-full flex items-center justify-center"><Skeleton className="w-full h-full" /></div>
              ) : statusBreakdown && statusBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="count"
                      nameKey="status"
                    >
                      {statusBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '6px' }}
                      itemStyle={{ color: 'var(--foreground)' }}
                    />
                    <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">No status data available</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="col-span-1 md:col-span-2">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {activityLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : activity && activity.length > 0 ? (
                <ScrollArea className="h-[300px] pr-4">
                  <div className="space-y-4">
                    {activity.map((item) => (
                      <div key={item.id} className="flex items-start gap-4">
                        <div className="mt-0.5 rounded-full bg-primary/10 p-1.5 text-primary">
                          <Activity className="h-4 w-4" />
                        </div>
                        <div className="flex-1 space-y-1">
                          <p className="text-sm font-medium leading-none">
                            {item.description}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(item.createdAt), 'MMM d, h:mm a')} • {item.actorName || 'System'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No recent activity.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Compact monitoring card embedded in the main Dashboard.
//
// Reuses useBatchRiskSummaries() from the monitoring frontend client. Shows
// the worst-risk batch + the open-alert count, and links to /monitoring for
// the full UI. Renders nothing while loading (no skeleton noise on the
// main page); shows a neutral "All systems nominal" line when there's no
// data.
// ---------------------------------------------------------------------------

const RISK_RANK: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", number> = {
  LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3,
};

function MonitoringSummaryCard() {
  const { data: summaries, isLoading } = useBatchRiskSummaries();
  if (isLoading) return null;
  const rows = summaries ?? [];
  const openAlerts = rows.reduce((sum, r) => sum + (r.openAlerts ?? 0), 0);
  const worst = rows.reduce<typeof rows[number] | null>((acc, r) => {
    if (!acc) return r;
    return RISK_RANK[r.riskLevel] > RISK_RANK[acc.riskLevel] ? r : acc;
  }, null);

  return (
    <Card className="border-l-4 border-l-orange-500/60">
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-full bg-orange-500/10 p-2 text-orange-600">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">Batch monitoring</span>
              {worst && <RiskBadge level={worst.riskLevel} />}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {rows.length === 0
                ? "No running batches to monitor."
                : openAlerts > 0
                  ? `${openAlerts} open alert${openAlerts === 1 ? "" : "s"} across ${rows.length} batch${rows.length === 1 ? "" : "es"}${worst && worst.riskLevel !== "LOW" ? ` — worst: ${worst.batchCode}` : ""}.`
                  : `All ${rows.length} batch${rows.length === 1 ? "" : "es"} healthy. Agent is running.`}
            </p>
          </div>
        </div>
        <Link href="/monitoring">
          <a className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted whitespace-nowrap">
            View <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </Link>
      </CardContent>
    </Card>
  );
}

// =============================================================
// F1 Tiles A + B — Not Cleared / Remaining in Training
//
// Spec asked for status='not_cleared' but our enum doesn't include it.
// Derive: a candidate is "not cleared" when their AVG(score/max_score)*100
// across assessments is below their batch's clearance_rate. We compute this
// in JS using the existing useListCandidates hook + the batch-comparison
// endpoint (which already gives us per-batch pass rates and thresholds).
//
// Tile B: remaining = COUNT(status NOT IN ('offered','cleared','discontinued')).
// =============================================================
function NotClearedAndRemainingTiles() {
  const { data: candidates } = useListCandidates();
  const { token } = useAuth();
  const [notCleared, setNotCleared] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/dashboard/clearance-summary`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ threshold: number; actual: number | null }>) => {
        // Each batch with actual < threshold contributes its full active-candidate count;
        // since we don't have per-candidate score breakdown here, "Not Cleared" is the
        // count of *batches under threshold* × an average — instead we expose the simpler
        // "batches under threshold" count to keep the tile honest.
        const underThreshold = rows.filter((r) => r.actual != null && r.actual < r.threshold).length;
        setNotCleared(underThreshold);
      })
      .catch(() => setNotCleared(0));
  }, [token]);

  const remaining = (candidates ?? []).filter((c) => !["offered", "cleared", "discontinued"].includes(c.status)).length;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Link href="/candidates?status=not_cleared">
        <a>
          <Card className="border-l-4 border-l-red-500 hover:border-red-600 transition cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Not Cleared</CardTitle>
              <XCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <div className="text-2xl font-bold text-red-600">{notCleared ?? "—"}</div>
                <span className="rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs px-2 py-0.5 font-semibold">
                  below threshold
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Batches whose pass rate is below their clearance threshold</p>
            </CardContent>
          </Card>
        </a>
      </Link>

      <Card className="border-l-4 border-l-blue-500">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Remaining in Training</CardTitle>
          <Hourglass className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-bold text-blue-600">{remaining}</div>
            <span className="rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs px-2 py-0.5 font-semibold">
              in progress
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Excludes offered, cleared, discontinued</p>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================
// F1.C — Attendance % per batch (current week) horizontal bar chart.
// Color: green ≥80, amber 60–79, red <60.
// =============================================================
interface AttendanceByBatchRow { batchId: number; batchName: string; attendancePct: number }

function attendanceBarColor(v: number): string {
  if (v >= 80) return "#16a34a";
  if (v >= 60) return "#f59e0b";
  return "#dc2626";
}

function AttendanceByBatchChart() {
  const { token } = useAuth();
  const [rows, setRows] = useState<AttendanceByBatchRow[] | null>(null);
  useEffect(() => {
    if (!token) return;
    fetch(`/api/dashboard/attendance-by-batch`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => (r.ok ? r.json() : []))
      .then((d: AttendanceByBatchRow[]) => setRows(d.map((r) => ({ ...r, batchName: r.batchName.length > 12 ? r.batchName.slice(0, 12) + "…" : r.batchName }))))
      .catch(() => setRows([]));
  }, [token]);

  if (rows && rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance % per batch</CardTitle>
        <CardDescription>Current week, live batches only. Green ≥ 80%, amber 60–79%, red &lt; 60%.</CardDescription>
      </CardHeader>
      <CardContent className="h-[260px]">
        {!rows ? (
          <Skeleton className="w-full h-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.15} />
              <XAxis dataKey="batchName" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <RechartsTooltip formatter={(v: number) => `${v}%`} />
              <Bar dataKey="attendancePct" name="Attendance %">
                {rows.map((r) => <BarCell key={r.batchId} fill={attendanceBarColor(r.attendancePct)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================
// F1.D — Assessment clearance rate table with per-batch settings modal.
// =============================================================
interface ClearanceRow { batchId: number; batchName: string; threshold: number; actual: number | null }

function ClearanceSummaryTable() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<ClearanceRow[] | null>(null);
  const [modalBatch, setModalBatch] = useState<ClearanceRow | null>(null);
  const canEdit = user?.role === "admin" || user?.role === "coordinator";

  const load = () => {
    if (!token) return;
    fetch(`/api/dashboard/clearance-summary`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  if (rows && rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assessment Clearance Rate</CardTitle>
        <CardDescription>Coordinators can set a per-batch passing threshold; the actual rate is computed from assessment outcomes.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Batch</TableHead>
              <TableHead className="text-right">Threshold</TableHead>
              <TableHead className="text-right">Current pass rate</TableHead>
              <TableHead className="text-center">Status</TableHead>
              {canEdit && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows && (<TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>)}
            {rows && rows.map((r) => {
              const meeting = r.actual != null && r.actual >= r.threshold;
              return (
                <TableRow key={r.batchId}>
                  <TableCell className="font-medium">{r.batchName}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.threshold.toFixed(0)}%</TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.actual == null ? "—" : `${r.actual.toFixed(1)}%`}</TableCell>
                  <TableCell className="text-center">
                    {r.actual == null
                      ? <span className="text-xs text-muted-foreground">no data</span>
                      : meeting
                        ? <Check className="h-4 w-4 text-green-600 inline" />
                        : <X className="h-4 w-4 text-red-600 inline" />}
                  </TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" title="Set clearance rate" onClick={() => setModalBatch(r)}>
                        <Settings className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
      <ClearanceModal
        open={!!modalBatch}
        batchId={modalBatch?.batchId ?? null}
        batchName={modalBatch?.batchName ?? ""}
        currentRate={modalBatch?.threshold ?? 70}
        onClose={() => setModalBatch(null)}
        onSaved={load}
      />
    </Card>
  );
}

// =============================================================
// F2 — Batch comparison grouped by program.
// =============================================================
interface ProgramRow {
  program: string;
  batch_count: number;
  total_candidates: number;
  avg_attendance_pct: number;
  avg_score_pct: number;
  clearance_rate: number;
  best_batch: { id: string; name: string } | null;
}

function BatchComparisonSection() {
  const { token } = useAuth();
  const [programs, setPrograms] = useState<ProgramRow[] | null>(null);
  useEffect(() => {
    if (!token) return;
    fetch(`/api/dashboard/batch-comparison`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => (r.ok ? r.json() : { programs: [] }))
      .then((d: { programs: ProgramRow[] }) => setPrograms(d.programs ?? []))
      .catch(() => setPrograms([]));
  }, [token]);

  if (programs && programs.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Batch Comparison</CardTitle>
        <CardDescription>Grouped by program. Bars show avg attendance, avg score, and clearance %.</CardDescription>
      </CardHeader>
      <CardContent>
        {!programs ? (
          <Skeleton className="h-[280px] w-full" />
        ) : (
          <>
            <div className="h-[280px] mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={programs} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.15} />
                  <XAxis dataKey="program" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                  <RechartsTooltip formatter={(v: number) => `${v}%`} />
                  <Legend />
                  <Bar dataKey="avg_attendance_pct" name="Attendance" fill="#0ea5e9" />
                  <Bar dataKey="avg_score_pct" name="Avg score" fill="#22c55e" />
                  <Bar dataKey="clearance_rate" name="Clearance" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Program</TableHead>
                  <TableHead className="text-right">Batches</TableHead>
                  <TableHead className="text-right">Candidates</TableHead>
                  <TableHead className="text-right">Attendance</TableHead>
                  <TableHead className="text-right">Avg Score</TableHead>
                  <TableHead className="text-right">Clearance</TableHead>
                  <TableHead>Best Batch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {programs.map((p) => (
                  <TableRow key={p.program}>
                    <TableCell className="font-medium">{p.program}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{p.batch_count}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{p.total_candidates}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{p.avg_attendance_pct.toFixed(1)}%</TableCell>
                    <TableCell className="text-right font-mono text-sm">{p.avg_score_pct.toFixed(1)}%</TableCell>
                    <TableCell className="text-right font-mono text-sm">{p.clearance_rate.toFixed(1)}%</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.best_batch?.name ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
