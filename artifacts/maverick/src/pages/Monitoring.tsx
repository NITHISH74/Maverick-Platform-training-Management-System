import { useState } from "react";
import {
  useMonitoringAlerts,
  useBatchRiskSummaries,
  useMonitoringConfig,
  useMonitoringEmailLog,
  useRunMonitoringScan,
  useUpdateMonitoringConfig,
  type MonitoringAlert,
} from "@/lib/monitoring-api";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, RefreshCw, Activity, Mail, Settings as SettingsIcon, ShieldAlert } from "lucide-react";
import { BatchRiskCard } from "@/components/monitoring/BatchRiskCard";
import { AlertCard } from "@/components/monitoring/AlertCard";
import { RiskBadge } from "@/components/monitoring/RiskBadge";

/**
 * Monitoring page — main risk dashboard for the autonomous batch monitoring agent.
 *
 * Shows three views in tabs:
 *   1. Overview     — top-line metrics + at-risk batch cards
 *   2. Alerts       — full alert inbox with filtering + actions
 *   3. Email log    — admin only; every email the agent dispatched
 *   4. Config       — admin only; thresholds + scheduler
 */
export default function Monitoring() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin";

  // Filters for the alert list
  const [statusFilter, setStatusFilter] = useState<"open" | "acknowledged" | "resolved" | "dismissed" | "all">("open");
  const [severityFilter, setSeverityFilter] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "all">("all");

  // Server queries
  const { data: summaries, isLoading: summariesLoading } = useBatchRiskSummaries();
  const { data: alerts, isLoading: alertsLoading } = useMonitoringAlerts(
    statusFilter === "all" ? undefined : { status: statusFilter },
  );

  const runScan = useRunMonitoringScan();
  const handleRunNow = () => {
    runScan.mutate(undefined, {
      onSuccess: (r) => {
        toast({
          title: "Scan complete",
          description: `${r.batchesScanned} batches scanned, ${r.alertsCreated} new alerts, ${r.emailsSent} emails sent.`,
        });
      },
      onError: (e) => {
        toast({
          title: "Scan failed",
          description: (e as Error)?.message ?? "Unknown error",
          variant: "destructive",
        });
      },
    });
  };

  // Filtered view (severity filter is client-side so the user can toggle quickly).
  const filteredAlerts = (alerts ?? []).filter((a) =>
    severityFilter === "all" ? true : a.severity === severityFilter,
  );

  // Top-line counts
  const totalBatches = summaries?.length ?? 0;
  const criticalBatches = summaries?.filter((s) => s.riskLevel === "CRITICAL").length ?? 0;
  const highBatches = summaries?.filter((s) => s.riskLevel === "HIGH").length ?? 0;
  const openAlerts = alerts?.filter((a) => a.status === "open").length ?? 0;

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-orange-500" />
              Batch Monitoring
            </h1>
            <p className="text-muted-foreground">
              Autonomous monitoring of batch health, attendance, assessments, and candidate risk.
            </p>
          </div>
          <Button onClick={handleRunNow} disabled={runScan.isPending}>
            <RefreshCw className={`mr-2 h-4 w-4 ${runScan.isPending ? "animate-spin" : ""}`} />
            {runScan.isPending ? "Scanning…" : "Run scan now"}
          </Button>
        </div>

        {/* Top-line tiles */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Batches monitored</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalBatches}</div>
              <p className="text-xs text-muted-foreground">Running batches only</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Critical batches</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{criticalBatches}</div>
              <p className="text-xs text-muted-foreground">{highBatches} at HIGH risk</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Open alerts</CardTitle>
              <AlertTriangle className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{openAlerts}</div>
              <p className="text-xs text-muted-foreground">Across all visible batches</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Agent status</CardTitle>
              <Activity className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Active</div>
              <p className="text-xs text-muted-foreground">Scheduler running</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="alerts">
              Alerts {openAlerts > 0 && <Badge variant="secondary" className="ml-2">{openAlerts}</Badge>}
            </TabsTrigger>
            {isAdmin && <TabsTrigger value="email-log"><Mail className="h-3 w-3 mr-1" />Email log</TabsTrigger>}
            {isAdmin && <TabsTrigger value="config"><SettingsIcon className="h-3 w-3 mr-1" />Config</TabsTrigger>}
          </TabsList>

          {/* --- OVERVIEW --- */}
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Batch risk summary</CardTitle>
                <CardDescription>
                  Per-batch health scores from attendance, clearance rate, and open alerts.
                  Click a card to drill into the batch's alerts.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {summariesLoading ? (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48" />)}
                  </div>
                ) : !summaries || summaries.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">No running batches to monitor.</p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {summaries.map((s) => <BatchRiskCard key={s.batchId} summary={s} />)}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent critical+high alerts as a compact list */}
            <Card>
              <CardHeader>
                <CardTitle>Most urgent open alerts</CardTitle>
                <CardDescription>The 5 most recent CRITICAL / HIGH alerts.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {alertsLoading ? (
                  <Skeleton className="h-24" />
                ) : (
                  (alerts ?? [])
                    .filter((a) => a.status === "open" && (a.severity === "CRITICAL" || a.severity === "HIGH"))
                    .slice(0, 5)
                    .map((a) => <AlertCard key={a.id} alert={a} compact />)
                )}
                {(alerts ?? []).filter((a) => a.status === "open").length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No open alerts. All batches healthy.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* --- ALERTS --- */}
          <TabsContent value="alerts" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle>Alert inbox</CardTitle>
                    <CardDescription>
                      Showing {filteredAlerts.length} alert{filteredAlerts.length === 1 ? "" : "s"}.
                      Acknowledge to mark as seen, resolve when handled.
                    </CardDescription>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="acknowledged">Acknowledged</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                        <SelectItem value="dismissed">Dismissed</SelectItem>
                        <SelectItem value="all">All statuses</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as typeof severityFilter)}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All severities</SelectItem>
                        <SelectItem value="CRITICAL">Critical</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="LOW">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {alertsLoading ? (
                  [...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)
                ) : filteredAlerts.length === 0 ? (
                  <p className="text-center py-12 text-muted-foreground">No alerts match the current filter.</p>
                ) : (
                  filteredAlerts.map((a: MonitoringAlert) => <AlertCard key={a.id} alert={a} />)
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* --- EMAIL LOG (admin only) --- */}
          {isAdmin && (
            <TabsContent value="email-log">
              <EmailLogTab />
            </TabsContent>
          )}

          {/* --- CONFIG (admin only) --- */}
          {isAdmin && (
            <TabsContent value="config">
              <ConfigTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Email log subview — admin only
// ---------------------------------------------------------------------------
function EmailLogTab() {
  const { data: log, isLoading } = useMonitoringEmailLog();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email log</CardTitle>
        <CardDescription>
          Every email the monitoring agent dispatched. Admins can audit recipients here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-48" />
        ) : !log || log.length === 0 ? (
          <p className="text-center py-12 text-muted-foreground">No emails sent yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground">{e.id}</TableCell>
                  <TableCell className="font-mono text-xs">{e.recipientEmail}</TableCell>
                  <TableCell className="capitalize text-sm">{e.recipientRole ?? "-"}</TableCell>
                  <TableCell className="text-sm">{e.subject}</TableCell>
                  <TableCell>
                    <Badge variant={e.status === "sent" ? "secondary" : "destructive"}>{e.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.provider ?? "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Config subview — admin only
// ---------------------------------------------------------------------------
function ConfigTab() {
  const { data: cfg, isLoading } = useMonitoringConfig();
  const update = useUpdateMonitoringConfig();
  const { toast } = useToast();

  // Local form state — initialised from server when cfg arrives.
  const [form, setForm] = useState<Record<string, string | number | boolean>>({});
  const initForm = (k: string, v: string | number | boolean) => (form[k] === undefined ? v : form[k]);

  const handleSave = () => {
    update.mutate(form as never, {
      onSuccess: () => toast({ title: "Saved", description: "Monitoring configuration updated." }),
      onError: (e) => toast({ title: "Save failed", description: (e as Error)?.message ?? "Unknown error", variant: "destructive" }),
    });
  };

  if (isLoading || !cfg) {
    return <Skeleton className="h-64" />;
  }

  const num = (k: keyof typeof cfg, label: string, suffix = "%") => (
    <div className="space-y-1">
      <Label htmlFor={k}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={k}
          type="number"
          step={k.toString().includes("Days") ? 1 : 0.5}
          value={String(initForm(k as string, cfg[k] as string | number))}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          className="max-w-32"
        />
        <span className="text-sm text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );

  const bool = (k: keyof typeof cfg, label: string, hint?: string) => (
    <div className="flex items-start justify-between gap-3 py-2">
      <div>
        <Label htmlFor={k}>{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch
        id={k}
        checked={Boolean(initForm(k as string, cfg[k] as boolean))}
        onCheckedChange={(v) => setForm({ ...form, [k]: v })}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Thresholds</CardTitle>
          <CardDescription>An alert fires when a batch's metric crosses any of these.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {num("attendanceBatchThresholdPct", "Batch attendance minimum")}
          {num("attendanceDropThresholdPct", "Week-over-week attendance drop")}
          {num("attendanceCandidateThresholdPct", "Per-candidate attendance minimum")}
          {num("assessmentPassThresholdPct", "Assessment pass threshold")}
          {num("clearanceThresholdPct", "Clearance rate minimum")}
          {num("consecutiveAbsenceDays", "Consecutive absent days", "days")}
          {num("assessmentOverdueDays", "Assessment overdue grace", "days")}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Email recipients</CardTitle>
          <CardDescription>Who gets emailed when an alert fires.</CardDescription>
        </CardHeader>
        <CardContent>
          {bool("emailTrainer", "Email trainer", "Send to all trainers assigned to the batch.")}
          {bool("emailCoordinator", "Email coordinator", "Send to the batch's coordinator.")}
          {bool("emailAdmin", "Email admins", "Admins see everything in the dashboard. Off by default per platform policy.")}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Scheduler</CardTitle>
          <CardDescription>Background scan cadence. Cron expression syntax.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {bool("schedulerEnabled", "Scheduler enabled", "Disable to stop background scans.")}
          <div className="space-y-1">
            <Label htmlFor="schedulerCron">Cron expression</Label>
            <Input
              id="schedulerCron"
              value={String(initForm("schedulerCron", cfg.schedulerCron))}
              onChange={(e) => setForm({ ...form, schedulerCron: e.target.value })}
              className="max-w-64 font-mono"
              placeholder="0 11 * * *"
            />
            <p className="text-xs text-muted-foreground">Default <code>0 11 * * *</code> — every day at 11:00.</p>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={update.isPending || Object.keys(form).length === 0}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
