import { useState, useRef } from "react";
import { useListAssessments, useCreateAssessment, useListBatches, useBulkUploadAssessmentScores, useListCandidates } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Plus, Upload, Download, CheckCircle2, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const ASSESSMENT_TYPES = [
  { value: "sprint_review", label: "Sprint Review" },
  { value: "coding", label: "Coding Test" },
  { value: "api", label: "API Assessment" },
  { value: "project_evaluation", label: "Project Evaluation" },
];

function CreateAssessmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const createAssessment = useCreateAssessment();
  const { data: batches } = useListBatches();

  const [form, setForm] = useState({
    title: "",
    type: "",
    batchId: "",
    scheduledDate: "",
    maxScore: "100",
    description: "",
  });
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.title || !form.type || !form.batchId || !form.scheduledDate) {
      setError("Title, type, batch, and scheduled date are required.");
      return;
    }
    createAssessment.mutate(
      {
        data: {
          title: form.title,
          type: form.type as "sprint_review" | "coding" | "api" | "project_evaluation",
          batchId: parseInt(form.batchId),
          scheduledDate: form.scheduledDate,
          maxScore: parseFloat(form.maxScore) || 100,
          description: form.description || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["listAssessments"] });
          onClose();
          setForm({ title: "", type: "", batchId: "", scheduledDate: "", maxScore: "100", description: "" });
        },
        onError: (err: unknown) => {
          setError(err instanceof Error ? err.message : "Failed to create assessment.");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Assessment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input placeholder="e.g. Sprint 1 Review" value={form.title} onChange={set("title")} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {ASSESSMENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Batch *</Label>
              <Select value={form.batchId} onValueChange={v => setForm(f => ({ ...f, batchId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
                <SelectContent>
                  {batches?.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Scheduled Date *</Label>
              <Input type="date" value={form.scheduledDate} onChange={set("scheduledDate")} />
            </div>
            <div className="space-y-1.5">
              <Label>Max Score</Label>
              <Input type="number" min="1" value={form.maxScore} onChange={set("maxScore")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea placeholder="Optional description or instructions..." value={form.description} onChange={set("description")} rows={3} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createAssessment.isPending}>
              {createAssessment.isPending ? "Creating..." : "Create Assessment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ScoreRow { candidateId: number; score: number; remarks?: string; candidateName: string; }

function parseScorecsvRows(text: string, candidates: { id: number; name: string; candidateId: string | null }[]): ScoreRow[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const result: ScoreRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = cols[i] ?? ""; });
    const idStr = obj["candidateid"] || obj["candidate_id"] || obj["id"] || "";
    const score = parseFloat(obj["score"] || "0");
    const candidate = candidates.find(c => c.candidateId === idStr || String(c.id) === idStr);
    if (!candidate || isNaN(score)) continue;
    result.push({ candidateId: candidate.id, candidateName: candidate.name, score, remarks: obj["remarks"] || undefined });
  }
  return result;
}

function BulkScoreDialog({
  open, onClose, assessments,
}: {
  open: boolean;
  onClose: () => void;
  assessments: { id: number; title: string; batchName: string }[];
}) {
  const queryClient = useQueryClient();
  const { data: candidates } = useListCandidates();
  const bulkUpload = useBulkUploadAssessmentScores();
  const fileRef = useRef<HTMLInputElement>(null);

  const [assessmentId, setAssessmentId] = useState("");
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ inserted: number; failed: number; errors: string[] } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = evt => {
      const text = evt.target?.result as string;
      const parsed = parseScorecsvRows(text, candidates ?? []);
      setRows(parsed);
      setFileError(parsed.length === 0 ? "No valid rows. Ensure columns: candidateId, score (and optionally remarks)" : null);
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const csv = "candidateId,score,remarks\nCAN001,85,Well done\nCAN002,72,Needs improvement";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk-scores-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleUpload() {
    if (!assessmentId || rows.length === 0) return;
    setMutError(null);
    bulkUpload.mutate(
      {
        data: {
          assessmentId: Number(assessmentId),
          scores: rows.map(r => ({ candidateId: r.candidateId, score: r.score, remarks: r.remarks })),
        },
      },
      {
        onSuccess: (data) => {
          setResult(data);
          queryClient.invalidateQueries({ queryKey: ["listAssessmentScores"] });
        },
        onError: (err: unknown) => {
          setMutError(err instanceof Error ? err.message : "Upload failed.");
        },
      }
    );
  }

  function handleClose() {
    setAssessmentId("");
    setRows([]);
    setFileName("");
    setResult(null);
    setFileError(null);
    setMutError(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Bulk Upload Assessment Scores</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Upload a CSV with candidateId, score, and optional remarks.</p>
            <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate} className="gap-2 shrink-0">
              <Download className="h-3.5 w-3.5" />
              Template
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label>Assessment</Label>
            <Select value={assessmentId} onValueChange={setAssessmentId}>
              <SelectTrigger><SelectValue placeholder="Select assessment" /></SelectTrigger>
              <SelectContent>
                {assessments.map(a => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.title} — {a.batchName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>CSV File</Label>
            <div
              className="border-2 border-dashed border-border rounded-md p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
              {fileName ? (
                <p className="text-sm font-medium">{fileName} — {rows.length} valid rows</p>
              ) : (
                <p className="text-sm text-muted-foreground">Click to select CSV file</p>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>
          {fileError && <p className="text-sm text-destructive">{fileError}</p>}
          {mutError && <p className="text-sm text-destructive">{mutError}</p>}
          {result && (
            <div className="rounded-md border p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span>{result.inserted} scores uploaded successfully</span>
              </div>
              {result.failed > 0 && (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p>{result.failed} failed</p>
                    {result.errors.slice(0, 5).map((e, i) => <p key={i} className="text-xs text-destructive/80">{e}</p>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>Close</Button>
          {!result && (
            <Button type="button" onClick={handleUpload} disabled={!assessmentId || rows.length === 0 || bulkUpload.isPending}>
              {bulkUpload.isPending ? "Uploading..." : `Upload ${rows.length} Scores`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Assessments() {
  const [showCreate, setShowCreate] = useState(false);
  const [showBulkScore, setShowBulkScore] = useState(false);
  const { data: assessments, isLoading } = useListAssessments();

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Assessments</h1>
            <p className="text-muted-foreground">Manage evaluations across batches.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowBulkScore(true)} className="gap-2">
              <Upload className="h-3.5 w-3.5" />
              Bulk Scores
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Assessment
            </Button>
          </div>
        </div>

        <CreateAssessmentDialog open={showCreate} onClose={() => setShowCreate(false)} />
        <BulkScoreDialog
          open={showBulkScore}
          onClose={() => setShowBulkScore(false)}
          assessments={assessments?.map(a => ({ id: a.id, title: a.title, batchName: a.batchName ?? "" })) ?? []}
        />

        <Card>
          <CardHeader>
            <CardTitle>Recent Assessments</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Max Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading assessments...</TableCell>
                  </TableRow>
                ) : assessments?.map((assessment) => (
                  <TableRow key={assessment.id}>
                    <TableCell className="font-medium">{assessment.title}</TableCell>
                    <TableCell>{assessment.batchName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {assessment.type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>{format(new Date(assessment.scheduledDate), "MMM d, yyyy")}</TableCell>
                    <TableCell className="font-mono">{assessment.maxScore}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
