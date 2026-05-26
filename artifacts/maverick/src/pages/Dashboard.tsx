import { useState } from "react";
import { Link } from "wouter";
import { useGetDashboardSummary, useGetRecentActivity, useGetCandidateStatusBreakdown, useGetAttendanceTrends } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users, GraduationCap, CalendarCheck, TrendingUp, AlertTriangle, Activity, ShieldAlert, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Layout } from "@/components/layout/Layout";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell } from "recharts";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBatchRiskSummaries } from "@/lib/monitoring-api";
import { RiskBadge } from "@/components/monitoring/RiskBadge";

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
