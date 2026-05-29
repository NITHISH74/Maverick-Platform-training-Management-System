import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useGetBatch, getGetBatchQueryKey, useListBatchCandidates, getListBatchCandidatesQueryKey, useListAttendance, getListAttendanceQueryKey, useListAssessments, getListAssessmentsQueryKey, useListToppers, getListToppersQueryKey, useGetAttendanceSummary, getGetAttendanceSummaryQueryKey, useCreateCandidate, useDeleteCandidate, useUpdateBatch, useListUsers, useUpdateBatchStatus } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Lock } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Users, Calendar, UserCheck, Trophy, Plus, Trash2, UserPlus } from "lucide-react";
import { Link } from "wouter";
import { Progress } from "@/components/ui/progress";
import { FeedbackIntelligenceCard } from "@/components/FeedbackIntelligenceCard";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";

export default function BatchDetail({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "coordinator";
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [showAssignTrainers, setShowAssignTrainers] = useState(false);

  const { data: batch, isLoading: isBatchLoading } = useGetBatch(id, {
    query: {
      enabled: !!id,
      queryKey: getGetBatchQueryKey(id),
    }
  });

  const { data: candidates, isLoading: isCandidatesLoading } = useListBatchCandidates(id, {
    query: {
      enabled: !!id,
      queryKey: getListBatchCandidatesQueryKey(id),
    }
  });

  const { data: attendanceSummary, isLoading: isAttendanceLoading } = useGetAttendanceSummary({ batchId: id }, {
    query: {
      enabled: !!id,
      queryKey: getGetAttendanceSummaryQueryKey({ batchId: id }),
    }
  });

  const { data: assessments, isLoading: isAssessmentsLoading } = useListAssessments({ batchId: id }, {
    query: {
      enabled: !!id,
      queryKey: getListAssessmentsQueryKey({ batchId: id }),
    }
  });

  const { data: toppers, isLoading: isToppersLoading } = useListToppers({ batchId: id }, {
    query: {
      enabled: !!id,
      queryKey: getListToppersQueryKey({ batchId: id }),
    }
  });

  return (
    <Layout>
      <div className="space-y-6">
        {isBatchLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        ) : batch ? (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight">{batch.name}</h1>
                <Badge
                  variant={batch.status === 'running' ? 'default' : 'secondary'}
                  className={
                    "uppercase text-xs " +
                    (batch.status === "closed"
                      ? "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                      : "")
                  }
                >
                  {batch.status}
                </Badge>
                {/* F5: manual Close batch — coord/admin only, only visible when
                    batch is completed OR today > end_date. */}
                <CloseBatchButton batch={batch} />
              </div>
              <p className="text-muted-foreground font-mono mt-1 text-sm">{batch.batchCode} • {batch.program}</p>
            </div>
            
            <div className="flex gap-4">
              <Card className="px-4 py-2 border-border shadow-sm flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-md text-primary">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Candidates</p>
                  <p className="font-bold text-sm">{batch.candidateCount || 0} / {batch.capacity}</p>
                </div>
              </Card>
              <Card className="px-4 py-2 border-border shadow-sm flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-md text-primary">
                  <Calendar className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Timeline</p>
                  <p className="font-bold text-sm">{format(new Date(batch.startDate), "MMM d")} - {format(new Date(batch.endDate), "MMM d, yyyy")}</p>
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        <Tabs defaultValue="candidates" className="w-full mt-6">
          <TabsList className="grid w-full grid-cols-4 max-w-[600px]">
            <TabsTrigger value="candidates">Candidates</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="assessments">Assessments</TabsTrigger>
            <TabsTrigger value="toppers">Toppers</TabsTrigger>
          </TabsList>
          
          <TabsContent value="candidates" className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>Batch Candidates</CardTitle>
                  <CardDescription>All enrolled candidates for this batch.</CardDescription>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    {(!batch?.trainerIds || batch.trainerIds.length === 0) && (
                      <Button variant="outline" size="sm" onClick={() => setShowAssignTrainers(true)}>
                        <UserPlus className="mr-2 h-4 w-4" /> Assign Trainer
                      </Button>
                    )}
                    {batch?.trainerIds && batch.trainerIds.length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => setShowAssignTrainers(true)}>
                        <UserPlus className="mr-2 h-4 w-4" /> Manage Trainers
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setShowAddCandidate(true)}>
                      <Plus className="mr-2 h-4 w-4" /> Add Candidate
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isCandidatesLoading ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading candidates...</TableCell>
                      </TableRow>
                    ) : candidates?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground border-t border-dashed">
                          No candidates enrolled yet.
                          {canManage && (
                            <div className="mt-3">
                              <Button size="sm" variant="outline" onClick={() => setShowAddCandidate(true)}>
                                <Plus className="mr-2 h-4 w-4" /> Add the first candidate
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : candidates?.map((candidate) => (
                      <CandidateRow key={candidate.id} candidate={candidate} batchId={id} canManage={canManage} />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="attendance" className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card>
              <CardHeader>
                <CardTitle>Attendance Summary</CardTitle>
                <CardDescription>Cumulative attendance metrics per candidate.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead className="text-right">Present</TableHead>
                      <TableHead className="text-right">Absent</TableHead>
                      <TableHead className="text-right">Leave/Late</TableHead>
                      <TableHead className="text-right w-[200px]">Compliance (%)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isAttendanceLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading attendance...</TableCell>
                      </TableRow>
                    ) : attendanceSummary?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground border-t border-dashed">No attendance records found.</TableCell>
                      </TableRow>
                    ) : attendanceSummary?.map((record) => (
                      <TableRow key={record.candidateId}>
                        <TableCell className="font-medium">
                          <Link href={`/candidates/${record.candidateId}`} className="hover:underline">
                            {record.candidateName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right text-green-600 font-medium">{record.presentDays}</TableCell>
                        <TableCell className="text-right text-destructive font-medium">{record.absentDays}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{record.leaveDays + record.lateDays}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-sm font-mono w-10 text-right">{Math.round(record.attendancePercent)}%</span>
                            <Progress 
                              value={record.attendancePercent} 
                              className="h-2 w-24"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="assessments" className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
             <Card>
              <CardHeader>
                <CardTitle>Batch Assessments</CardTitle>
                <CardDescription>Scheduled and completed evaluations.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Max Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isAssessmentsLoading ? (
                       <TableRow>
                         <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading assessments...</TableCell>
                       </TableRow>
                     ) : assessments?.length === 0 ? (
                       <TableRow>
                         <TableCell colSpan={4} className="text-center py-8 text-muted-foreground border-t border-dashed">No assessments scheduled.</TableCell>
                       </TableRow>
                     ) : assessments?.map((assessment) => (
                      <TableRow key={assessment.id}>
                        <TableCell className="font-medium">{assessment.title}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="capitalize text-[10px]">
                            {assessment.type.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{format(new Date(assessment.scheduledDate), "MMM d, yyyy")}</TableCell>
                        <TableCell className="text-right font-mono">{assessment.maxScore}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="toppers" className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  Top Performers
                </CardTitle>
                <CardDescription>Ranked by composite performance score.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px] text-center">Rank</TableHead>
                      <TableHead>Candidate</TableHead>
                      <TableHead className="text-right">Assessment</TableHead>
                      <TableHead className="text-right">Project</TableHead>
                      <TableHead className="text-right">Attendance</TableHead>
                      <TableHead className="text-right text-primary font-bold">Total Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isToppersLoading ? (
                       <TableRow>
                         <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading leaderboard...</TableCell>
                       </TableRow>
                     ) : toppers?.length === 0 ? (
                       <TableRow>
                         <TableCell colSpan={6} className="text-center py-8 text-muted-foreground border-t border-dashed">No topper data calculated yet.</TableCell>
                       </TableRow>
                     ) : toppers?.map((topper) => (
                      <TableRow key={topper.id} className={topper.rank <= 3 ? "bg-muted/30" : ""}>
                        <TableCell className="text-center">
                          {topper.rank === 1 ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-yellow-500 text-xs font-bold text-white shadow-sm">1</span>
                          ) : topper.rank === 2 ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-xs font-bold text-slate-800 shadow-sm">2</span>
                          ) : topper.rank === 3 ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-600 text-xs font-bold text-white shadow-sm">3</span>
                          ) : (
                            <span className="font-mono text-muted-foreground">{topper.rank}</span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link href={`/candidates/${topper.candidateId}`} className="hover:underline">
                            {topper.candidateName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{Math.round(topper.assessmentScore || 0)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{Math.round(topper.projectScore || 0)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{Math.round(topper.attendanceScore || 0)}</TableCell>
                        <TableCell className="text-right font-mono font-bold text-primary">{Math.round(topper.totalScore * 100) / 100}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* V6 F1: Attendance Settings — coordinator/admin only. */}
        {canManage && <AttendanceSettingsSection batchId={id} />}

        {/* Feedback Intelligence (F3) — appended at the bottom; no existing
            batch-detail content was removed or reordered. */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Feedback Intelligence</h2>
          <FeedbackIntelligenceCard batchId={id} />
        </div>
      </div>

      {canManage && (
        <>
          <AddCandidateDialog
            open={showAddCandidate}
            onClose={() => setShowAddCandidate(false)}
            batchId={id}
          />
          <AssignTrainersDialog
            open={showAssignTrainers}
            onClose={() => setShowAssignTrainers(false)}
            batchId={id}
            currentTrainerIds={batch?.trainerIds ?? []}
          />
        </>
      )}
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Candidate row with optional remove button (admin/coordinator only).
// Removal hits DELETE /candidates/:id which writes an audit_logs row server-side.
// ---------------------------------------------------------------------------
function CandidateRow({
  candidate,
  batchId,
  canManage,
}: {
  candidate: { id: number; candidateId: string; name: string; status: string };
  batchId: number;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const deleteCandidate = useDeleteCandidate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");

  const handleRemove = () => {
    deleteCandidate.mutate(
      { id: candidate.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBatchCandidatesQueryKey(batchId) });
          queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
          setConfirmOpen(false);
          setReason("");
        },
      }
    );
  };

  return (
    <>
      <TableRow className="hover:bg-muted/50 transition-colors">
        <TableCell className="font-mono text-sm">{candidate.candidateId}</TableCell>
        <TableCell className="font-medium">{candidate.name}</TableCell>
        <TableCell>
          <Badge variant="outline" className="uppercase text-[10px]">{candidate.status}</Badge>
        </TableCell>
        <TableCell className="text-right space-x-3">
          <Link href={`/candidates/${candidate.id}`} className="text-primary hover:underline text-sm font-medium">
            View Profile
          </Link>
          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </TableCell>
      </TableRow>
      <Dialog open={confirmOpen} onOpenChange={v => !v && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove candidate</DialogTitle>
            <DialogDescription>
              Remove <strong>{candidate.name}</strong> ({candidate.candidateId}) from this batch?
              This action is logged in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason (optional, for audit log)</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. requested transfer, withdrew" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteCandidate.isPending}
              onClick={handleRemove}
            >
              {deleteCandidate.isPending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Add candidate to this batch (admin/coordinator only).
// ---------------------------------------------------------------------------
function AddCandidateDialog({
  open,
  onClose,
  batchId,
}: {
  open: boolean;
  onClose: () => void;
  batchId: number;
}) {
  const queryClient = useQueryClient();
  const createCandidate = useCreateCandidate();
  const [form, setForm] = useState({ candidateId: "", name: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.candidateId || !form.name || !form.email) {
      setError("Candidate ID, name, and email are required.");
      return;
    }
    createCandidate.mutate(
      {
        data: {
          candidateId: form.candidateId,
          name: form.name,
          email: form.email,
          phone: form.phone || undefined,
          batchId,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBatchCandidatesQueryKey(batchId) });
          queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
          setForm({ candidateId: "", name: "", email: "", phone: "" });
          onClose();
        },
        onError: (err: unknown) => {
          setError(err instanceof Error ? err.message : "Failed to add candidate.");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add candidate to batch</DialogTitle>
          <DialogDescription>
            Enroll a new candidate. They'll appear in attendance and assessment rosters.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Candidate ID *</Label>
              <Input value={form.candidateId} onChange={e => setForm(f => ({ ...f, candidateId: e.target.value }))} placeholder="e.g. CAND-001" />
            </div>
            <div className="space-y-1.5">
              <Label>Full Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Doe" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createCandidate.isPending}>
              {createCandidate.isPending ? "Adding..." : "Add candidate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Assign / manage trainers for this batch (admin/coordinator only).
// Uses PATCH /batches/:id with trainerIds (replaces full set).
// ---------------------------------------------------------------------------
function AssignTrainersDialog({
  open,
  onClose,
  batchId,
  currentTrainerIds,
}: {
  open: boolean;
  onClose: () => void;
  batchId: number;
  currentTrainerIds: number[];
}) {
  const queryClient = useQueryClient();
  const updateBatch = useUpdateBatch();
  const { data: users } = useListUsers();
  const trainers = users?.filter(u => u.role === "trainer") ?? [];
  const [selected, setSelected] = useState<number[]>(currentTrainerIds);

  // Re-sync if the modal re-opens for a different batch state.
  if (open && selected !== currentTrainerIds && selected.length === 0 && currentTrainerIds.length > 0) {
    setSelected(currentTrainerIds);
  }

  const toggle = (id: number) => setSelected(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);

  const handleSave = () => {
    updateBatch.mutate(
      { id: batchId, data: { trainerIds: selected } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
          onClose();
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign trainers</DialogTitle>
          <DialogDescription>
            Select one or more trainers for this batch. They'll see this batch in their dashboard.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 overflow-y-auto border rounded-md p-2 space-y-1">
          {trainers.length === 0 ? (
            <p className="text-sm text-muted-foreground p-2">No trainers found in the system.</p>
          ) : trainers.map(t => (
            <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-2 py-1">
              <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} className="h-4 w-4" />
              <span className="flex-1">{t.name}</span>
              <span className="text-xs text-muted-foreground">{t.email}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{selected.length} trainer(s) selected</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateBatch.isPending}>
            {updateBatch.isPending ? "Saving..." : "Save assignments"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================
// V6 F1: per-batch attendance due-time settings.
// Reads / writes /api/batches/:id/attendance-settings.
// =============================================================
function AttendanceSettingsSection({ batchId }: { batchId: number }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dueTime, setDueTime] = useState("10:00");
  const [enabled, setEnabled] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const token = localStorage.getItem("token") ?? "";
      const r = await fetch(`/api/batches/${batchId}/attendance-settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) { if (!cancelled) setLoading(false); return; }
      const d = await r.json();
      if (cancelled) return;
      setDueTime(typeof d.dueTime === "string" ? d.dueTime.slice(0, 5) : "10:00");
      setEnabled(d.enabled !== false);
      setUpdatedAt(d.updatedAt ?? null);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [batchId]);

  async function handleSave() {
    setSaving(true);
    try {
      const token = localStorage.getItem("token") ?? "";
      const r = await fetch(`/api/batches/${batchId}/attendance-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ due_time: dueTime.length === 5 ? `${dueTime}:00` : dueTime, enabled }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${r.status}`);
      }
      const d = await r.json();
      setUpdatedAt(d.updatedAt ?? new Date().toISOString());
      toast({ title: "Attendance settings saved", description: `Due time set to ${dueTime} IST.` });
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance Settings</CardTitle>
        <CardDescription>Daily cut-off after which a missing-attendance email is sent to the coordinator.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex items-end gap-4 flex-wrap">
              <div className="space-y-1.5">
                <Label>Daily attendance due time</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={dueTime}
                    onChange={e => setDueTime(e.target.value)}
                    className="w-36"
                  />
                  <span className="text-xs text-muted-foreground">(IST)</span>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm pb-2">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                Enable cut-off alerts
              </label>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
            {updatedAt && (
              <p className="text-xs text-muted-foreground">
                Last updated: {format(new Date(updatedAt), "MMM d, yyyy 'at' HH:mm")}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================
// F5: Close batch button — coordinator/admin only. Visible when the
// batch is in status 'completed' OR today > end_date. Posts to the
// existing PATCH /api/batches/:id/status with { status: 'closed' }.
// =============================================================
function CloseBatchButton({ batch }: { batch: { id: number; name: string; status: string; endDate: string } }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const updateStatus = useUpdateBatchStatus();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const canSeeButton = user?.role === "admin" || user?.role === "coordinator";
  if (!canSeeButton) return null;
  if (batch.status === "closed") return null;

  const past = new Date(batch.endDate) < new Date(new Date().toISOString().slice(0, 10));
  const eligible = batch.status === "completed" || past;
  if (!eligible) return null;

  function onConfirm() {
    updateStatus.mutate(
      { id: batch.id, data: { status: "closed" as any } },
      {
        onSuccess: () => {
          toast({ title: "Batch closed", description: `${batch.name} is now closed.` });
          setOpen(false);
          qc.invalidateQueries({ queryKey: getGetBatchQueryKey(batch.id) });
          qc.invalidateQueries({ queryKey: ["listBatches"] });
        },
        onError: (e) => {
          toast({
            title: "Failed to close",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          });
        },
      },
    );
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
        <Lock className="h-3.5 w-3.5" />
        Close Batch
      </Button>
      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close this batch?</DialogTitle>
            <DialogDescription>
              No further attendance or assessments can be recorded for <span className="font-medium">{batch.name}</span> after it is closed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={updateStatus.isPending}>Cancel</Button>
            <Button onClick={onConfirm} disabled={updateStatus.isPending}>
              {updateStatus.isPending ? "Closing…" : "Close batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
