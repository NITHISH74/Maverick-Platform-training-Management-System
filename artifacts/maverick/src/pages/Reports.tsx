import { useState } from "react";
import {
  useGetAttendanceReport,
  useGetAssessmentReport,
  useGetTopperReport,
  useGetConsolidatedReport,
  useGetAttendanceAlerts,
  useListBatches,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Download, FileText, Trophy, Users, CalendarCheck, FileDown, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

function downloadCSV(filename: string, rows: string[][]) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// PDF download goes through the same /api/reports/* endpoint with
// ?format=pdf; the backend forwards to the AI service which narrates +
// renders. We can't use the generated TanStack hook here because the
// response is a binary stream, not JSON — so this drops to a raw fetch.
async function downloadPdf(
  endpoint: string,
  query: Record<string, string | number | undefined>,
  filename: string,
  token: string | null,
): Promise<void> {
  if (!token) throw new Error("not authenticated");
  const url = new URL(endpoint, window.location.origin);
  url.searchParams.set("format", "pdf");
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

export default function Reports() {
  const [selectedBatch, setSelectedBatch] = useState<string>("all");
  const batchId = selectedBatch !== "all" ? Number(selectedBatch) : undefined;
  const { token } = useAuth();
  const { toast } = useToast();
  // Per-report "is this PDF rendering?" flag. The AI summary call takes a few
  // seconds, so we surface a spinner + disable the button until it's back.
  const [pdfBusy, setPdfBusy] = useState<Record<string, boolean>>({});

  async function runPdfDownload(
    key: "attendance" | "assessment" | "topper" | "consolidated",
    endpoint: string,
    filename: string,
  ): Promise<void> {
    setPdfBusy(s => ({ ...s, [key]: true }));
    try {
      await downloadPdf(endpoint, { batchId }, filename, token);
    } catch (e) {
      toast({
        title: "PDF download failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPdfBusy(s => ({ ...s, [key]: false }));
    }
  }

  const { data: batches } = useListBatches();
  const { data: attendanceReport, isLoading: attendanceLoading } = useGetAttendanceReport({ batchId });
  const { data: assessmentReport, isLoading: assessmentLoading } = useGetAssessmentReport({ batchId });
  const { data: topperReport, isLoading: topperLoading } = useGetTopperReport({ batchId });
  const { data: consolidatedReport, isLoading: consolidatedLoading } = useGetConsolidatedReport({ batchId });
  const { data: alerts, isLoading: alertsLoading } = useGetAttendanceAlerts();

  function exportAttendance() {
    if (!attendanceReport) return;
    const headers = ["Candidate ID", "Candidate Name", "Batch", "Date", "Status", "Remarks"];
    const rows = attendanceReport.map(r => [
      r.candidateId ?? "", r.candidateName, r.batchName, r.date, r.status, r.remarks ?? "",
    ]);
    downloadCSV("attendance-report.csv", [headers, ...rows]);
  }

  function exportAssessments() {
    if (!assessmentReport) return;
    const headers = ["Candidate Name", "Batch", "Assessment", "Type", "Score", "Max Score", "Percentage", "Date"];
    const rows = assessmentReport.map(r => [
      r.candidateName, r.batchName, r.assessmentTitle, r.assessmentType,
      String(r.score), String(r.maxScore), `${r.percentage}%`, r.scheduledDate ?? "",
    ]);
    downloadCSV("assessment-report.csv", [headers, ...rows]);
  }

  function exportToppers() {
    if (!topperReport) return;
    const headers = ["Rank", "Candidate Name", "Batch", "Total Score", "Assessment Score", "Project Score", "Attendance Score"];
    const rows = topperReport.map(r => [
      String(r.rank), r.candidateName, r.batchName, String(r.totalScore),
      String(r.assessmentScore ?? ""), String(r.projectScore ?? ""), String(r.attendanceScore ?? ""),
    ]);
    downloadCSV("topper-report.csv", [headers, ...rows]);
  }

  function exportConsolidated() {
    if (!consolidatedReport) return;
    const headers = ["Candidate ID", "Candidate Name", "Batch", "Status", "Attendance %", "Avg Score %", "Joined At"];
    const rows = consolidatedReport.map(r => [
      r.candidateId ?? "", r.candidateName, r.batchName, r.status,
      `${r.attendancePct}%`, `${r.avgScore}%`, r.joinedAt ?? "",
    ]);
    downloadCSV("consolidated-report.csv", [headers, ...rows]);
  }

  const statusColors: Record<string, string> = {
    active: "default",
    discontinued: "destructive",
    cleared: "secondary",
    offered: "outline",
    onboarded: "outline",
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
            <p className="text-muted-foreground">Attendance, assessments, toppers, and consolidated candidate data.</p>
          </div>
          <div className="w-52">
            <Select value={selectedBatch} onValueChange={setSelectedBatch}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by batch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Batches</SelectItem>
                {batches?.map(b => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {alerts && alerts.length > 0 && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <CardTitle className="text-sm font-semibold text-destructive">
                  Consecutive Absence Alerts — {alerts.length} candidate{alerts.length > 1 ? "s" : ""}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {alertsLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {alerts.map(a => (
                    <div key={a.candidateId} className="flex items-start justify-between rounded-md border border-destructive/20 bg-background p-3">
                      <div>
                        <p className="text-sm font-medium">{a.candidateName}</p>
                        <p className="text-xs text-muted-foreground">{a.batchName}</p>
                        <p className="text-xs text-muted-foreground">Last absence: {a.lastAbsenceDate}</p>
                      </div>
                      <Badge variant="destructive" className="ml-2 shrink-0">
                        {a.consecutiveAbsences} absent
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="consolidated">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="consolidated" className="gap-2">
              <Users className="h-3.5 w-3.5" />
              Consolidated
            </TabsTrigger>
            <TabsTrigger value="attendance" className="gap-2">
              <CalendarCheck className="h-3.5 w-3.5" />
              Attendance
            </TabsTrigger>
            <TabsTrigger value="assessments" className="gap-2">
              <FileText className="h-3.5 w-3.5" />
              Assessments
            </TabsTrigger>
            <TabsTrigger value="toppers" className="gap-2">
              <Trophy className="h-3.5 w-3.5" />
              Toppers
            </TabsTrigger>
          </TabsList>

          <TabsContent value="consolidated" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Consolidated Candidate Report</CardTitle>
                  <CardDescription>Status, attendance, and assessment average per candidate</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportConsolidated} disabled={!consolidatedReport?.length}>
                    <Download className="h-3.5 w-3.5 mr-2" />
                    Export CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runPdfDownload("consolidated", "/api/reports/consolidated", "consolidated-report.pdf")}
                    disabled={!consolidatedReport?.length || pdfBusy.consolidated}
                    title="AI-narrated PDF with executive summary, insights, risks, and recommendations"
                  >
                    {pdfBusy.consolidated
                      ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                      : <FileDown className="h-3.5 w-3.5 mr-2" />}
                    Download PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {consolidatedLoading ? (
                  <div className="space-y-2">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : consolidatedReport && consolidatedReport.length > 0 ? (
                  <div className="rounded-md border overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Candidate ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Batch</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Attendance</TableHead>
                          <TableHead className="text-right">Avg Score</TableHead>
                          <TableHead>Joined</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {consolidatedReport.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{r.candidateId ?? "—"}</TableCell>
                            <TableCell className="font-medium">{r.candidateName}</TableCell>
                            <TableCell>{r.batchName}</TableCell>
                            <TableCell>
                              <Badge variant={(statusColors[r.status] as "default" | "destructive" | "secondary" | "outline") ?? "outline"}>
                                {r.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{r.attendancePct}%</TableCell>
                            <TableCell className="text-right">{r.avgScore}%</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.joinedAt ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No data available.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="attendance" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Attendance Report</CardTitle>
                  <CardDescription>Daily attendance records per candidate and batch</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportAttendance} disabled={!attendanceReport?.length}>
                    <Download className="h-3.5 w-3.5 mr-2" />
                    Export CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runPdfDownload("attendance", "/api/reports/attendance", "attendance-report.pdf")}
                    disabled={!attendanceReport?.length || pdfBusy.attendance}
                    title="AI-narrated PDF with executive summary, insights, risks, and recommendations"
                  >
                    {pdfBusy.attendance
                      ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                      : <FileDown className="h-3.5 w-3.5 mr-2" />}
                    Download PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {attendanceLoading ? (
                  <div className="space-y-2">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : attendanceReport && attendanceReport.length > 0 ? (
                  <div className="rounded-md border overflow-auto max-h-[600px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Candidate</TableHead>
                          <TableHead>Batch</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Remarks</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {attendanceReport.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{r.candidateName}</TableCell>
                            <TableCell>{r.batchName}</TableCell>
                            <TableCell className="font-mono text-xs">{r.date}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  r.status === "present" ? "default"
                                  : r.status === "absent" ? "destructive"
                                  : "secondary"
                                }
                              >
                                {r.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.remarks ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No attendance data available.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assessments" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Assessment Score Report</CardTitle>
                  <CardDescription>Scores per candidate per assessment with normalised percentages</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportAssessments} disabled={!assessmentReport?.length}>
                    <Download className="h-3.5 w-3.5 mr-2" />
                    Export CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runPdfDownload("assessment", "/api/reports/assessments", "assessment-report.pdf")}
                    disabled={!assessmentReport?.length || pdfBusy.assessment}
                    title="AI-narrated PDF with executive summary, insights, risks, and recommendations"
                  >
                    {pdfBusy.assessment
                      ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                      : <FileDown className="h-3.5 w-3.5 mr-2" />}
                    Download PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {assessmentLoading ? (
                  <div className="space-y-2">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : assessmentReport && assessmentReport.length > 0 ? (
                  <div className="rounded-md border overflow-auto max-h-[600px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Candidate</TableHead>
                          <TableHead>Batch</TableHead>
                          <TableHead>Assessment</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Score</TableHead>
                          <TableHead className="text-right">Max</TableHead>
                          <TableHead className="text-right">%</TableHead>
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assessmentReport.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{r.candidateName}</TableCell>
                            <TableCell>{r.batchName}</TableCell>
                            <TableCell>{r.assessmentTitle}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{r.assessmentType.replace(/_/g, " ")}</Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">{r.score}</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">{r.maxScore}</TableCell>
                            <TableCell className={`text-right font-semibold ${r.percentage >= 60 ? "text-emerald-600" : "text-destructive"}`}>
                              {r.percentage}%
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.scheduledDate ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No assessment data available.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="toppers" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Topper Report</CardTitle>
                  <CardDescription>WCS-ranked candidates with component score breakdown</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportToppers} disabled={!topperReport?.length}>
                    <Download className="h-3.5 w-3.5 mr-2" />
                    Export CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runPdfDownload("topper", "/api/reports/toppers", "topper-report.pdf")}
                    disabled={!topperReport?.length || pdfBusy.topper}
                    title="AI-narrated PDF with executive summary, insights, risks, and recommendations"
                  >
                    {pdfBusy.topper
                      ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                      : <FileDown className="h-3.5 w-3.5 mr-2" />}
                    Download PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {topperLoading ? (
                  <div className="space-y-2">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : topperReport && topperReport.length > 0 ? (
                  <div className="rounded-md border overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Rank</TableHead>
                          <TableHead>Candidate</TableHead>
                          <TableHead>Batch</TableHead>
                          <TableHead className="text-right">Total Score</TableHead>
                          <TableHead className="text-right">Assessment</TableHead>
                          <TableHead className="text-right">Project</TableHead>
                          <TableHead className="text-right">Attendance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topperReport.map((r) => (
                          <TableRow key={r.rank} className={r.rank <= 3 ? "bg-muted/30" : ""}>
                            <TableCell className="font-bold text-center">
                              {r.rank === 1 ? "1st" : r.rank === 2 ? "2nd" : r.rank === 3 ? "3rd" : `${r.rank}th`}
                            </TableCell>
                            <TableCell className="font-medium">{r.candidateName}</TableCell>
                            <TableCell>{r.batchName}</TableCell>
                            <TableCell className="text-right font-bold">{r.totalScore}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{r.assessmentScore ?? "—"}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{r.projectScore ?? "—"}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{r.attendanceScore ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No topper data. Run the Toppers computation first.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
