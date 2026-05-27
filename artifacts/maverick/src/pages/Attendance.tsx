import { useState, useRef, useCallback } from "react";
import {
  useListBatches,
  useListAttendance,
  useBulkCreateAttendance,
  useListCandidates,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { format } from "date-fns";
import { Search, Download, Upload, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

type AttendanceStatus = "present" | "absent" | "leave" | "late";

function exportToCsv(records: Array<{ candidateName?: string | null; date?: string; status?: string; remarks?: string | null }>, date: string) {
  const rows = [
    ["Candidate", "Date", "Status", "Remarks"],
    ...records.map(r => [
      r.candidateName ?? "",
      r.date ?? date,
      r.status ?? "",
      r.remarks ?? "",
    ]),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function BulkUploadDialog({
  open,
  onClose,
  batchId,
  date,
}: {
  open: boolean;
  onClose: () => void;
  batchId: string;
  date: string;
}) {
  const queryClient = useQueryClient();
  const bulkCreate = useBulkCreateAttendance();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Array<{ candidateId: number; status: AttendanceStatus; remarks: string }>>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParseError(null);
    setPreview([]);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const lines = text.trim().split("\n").filter(Boolean);
      if (lines.length < 2) { setParseError("CSV must have a header row and at least one data row."); return; }
      const header = lines[0].split(",").map(h => h.replace(/"/g, "").trim().toLowerCase());
      const idIdx = header.indexOf("candidateid");
      const statusIdx = header.indexOf("status");
      const remarksIdx = header.indexOf("remarks");
      if (idIdx === -1 || statusIdx === -1) {
        setParseError("CSV must have columns: candidateId, status (and optionally remarks).");
        return;
      }
      const valid: AttendanceStatus[] = ["present", "absent", "leave", "late"];
      const parsed = lines.slice(1).map((line, i) => {
        const cols = line.split(",").map(c => c.replace(/"/g, "").trim());
        const id = parseInt(cols[idIdx]);
        const status = cols[statusIdx]?.toLowerCase() as AttendanceStatus;
        if (isNaN(id)) { setParseError(`Row ${i + 2}: invalid candidateId "${cols[idIdx]}"`); return null; }
        if (!valid.includes(status)) { setParseError(`Row ${i + 2}: status must be present/absent/leave/late`); return null; }
        return { candidateId: id, status, remarks: remarksIdx !== -1 ? (cols[remarksIdx] ?? "") : "" };
      });
      if (parsed.some(p => p === null)) return;
      setPreview(parsed as Array<{ candidateId: number; status: AttendanceStatus; remarks: string }>);
    };
    reader.readAsText(file);
  };

  const handleSubmit = () => {
    if (!batchId || preview.length === 0) return;
    setSubmitError(null);
    bulkCreate.mutate(
      {
        data: {
          batchId: parseInt(batchId),
          date,
          records: preview.map(r => ({ candidateId: r.candidateId, status: r.status, remarks: r.remarks || undefined })),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["listAttendance"] });
          onClose();
          setPreview([]);
          if (fileRef.current) fileRef.current.value = "";
        },
        onError: (err: unknown) => setSubmitError(err instanceof Error ? err.message : "Upload failed."),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk Upload Attendance</DialogTitle>
          <DialogDescription>
            Upload a CSV file with columns: <span className="font-mono text-xs">candidateId, status, remarks</span>.<br />
            Valid statuses: present, absent, leave, late.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>CSV File</Label>
            <Input type="file" accept=".csv,text/csv" ref={fileRef} onChange={handleFile} />
          </div>
          {parseError && <p className="text-sm text-destructive">{parseError}</p>}
          {preview.length > 0 && (
            <div className="rounded border text-sm max-h-48 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 10).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.candidateId}</TableCell>
                      <TableCell className="capitalize">{r.status}</TableCell>
                      <TableCell>{r.remarks}</TableCell>
                    </TableRow>
                  ))}
                  {preview.length > 10 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground text-xs py-2">
                        ...and {preview.length - 10} more rows
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {submitError && <p className="text-sm text-destructive">{submitError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={preview.length === 0 || bulkCreate.isPending}>
            {bulkCreate.isPending ? "Uploading..." : `Upload ${preview.length > 0 ? `${preview.length} records` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RosterRow({
  record,
}: {
  record: { id: number; candidateName?: string | null; status?: string | null; remarks?: string | null };
}) {
  const [status, setStatus] = useState<AttendanceStatus>((record.status as AttendanceStatus) ?? "present");
  const [remarks, setRemarks] = useState(record.remarks ?? "");
  const [saved, setSaved] = useState(false);
  const bulkCreate = useBulkCreateAttendance();

  const handleSave = () => {
    bulkCreate.mutate(
      { data: { batchId: 0, date: "", records: [{ candidateId: record.id, status, remarks: remarks || undefined }] } },
      { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); } }
    );
  };

  return (
    <TableRow>
      <TableCell className="font-medium">{record.candidateName}</TableCell>
      <TableCell>
        <Select value={status} onValueChange={v => { setStatus(v as AttendanceStatus); setSaved(false); }}>
          <SelectTrigger className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="present"><div className="flex items-center gap-2 text-green-600"><div className="h-2 w-2 rounded-full bg-green-500" /> Present</div></SelectItem>
            <SelectItem value="absent"><div className="flex items-center gap-2 text-destructive"><div className="h-2 w-2 rounded-full bg-destructive" /> Absent</div></SelectItem>
            <SelectItem value="leave"><div className="flex items-center gap-2 text-amber-500"><div className="h-2 w-2 rounded-full bg-amber-500" /> Leave</div></SelectItem>
            <SelectItem value="late"><div className="flex items-center gap-2 text-blue-500"><div className="h-2 w-2 rounded-full bg-blue-500" /> Late</div></SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input value={remarks} onChange={e => { setRemarks(e.target.value); setSaved(false); }} placeholder="Add note..." className="h-8" />
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" onClick={handleSave} disabled={bulkCreate.isPending}>
          {saved ? "Saved" : "Save"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function Attendance() {
  const [selectedBatch, setSelectedBatch] = useState<string>("");
  const [date, setDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const queryClient = useQueryClient();
  const bulkCreate = useBulkCreateAttendance();

  // Show batches in any pre-completed state so newly-created (planned) batches
  // are also pickable in the dropdown. Completed/archived batches are hidden
  // client-side below.
  const { data: allBatches } = useListBatches({});
  const batches = (allBatches ?? []).filter(b => b.status !== "completed" && b.status !== "archived");

  const { data: records, isLoading, refetch } = useListAttendance(
    { batchId: selectedBatch ? parseInt(selectedBatch) : undefined, date },
    { query: { queryKey: ["listAttendance", selectedBatch, date], enabled: rosterLoaded && !!selectedBatch } }
  );

  const { data: allCandidates } = useListCandidates(
    { batchId: selectedBatch ? parseInt(selectedBatch) : undefined },
    { query: { queryKey: ["listCandidates", selectedBatch], enabled: !!selectedBatch } }
  );

  const handleLoadRoster = useCallback(() => {
    setRosterLoaded(true);
    if (rosterLoaded) {
      queryClient.invalidateQueries({ queryKey: ["listAttendance", selectedBatch, date] });
      refetch();
    }
  }, [rosterLoaded, selectedBatch, date, queryClient, refetch]);

  const handleInitRoster = () => {
    if (!selectedBatch || !allCandidates?.length) return;
    bulkCreate.mutate(
      {
        data: {
          batchId: parseInt(selectedBatch),
          date,
          records: allCandidates.map(c => ({ candidateId: c.id, status: "present" as AttendanceStatus })),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["listAttendance", selectedBatch, date] });
        },
      }
    );
  };

  const handleExport = () => {
    if (!records?.length) return;
    exportToCsv(records, date);
  };

  const filteredRecords = records?.filter(r =>
    !search || (r.candidateName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Attendance Log</h1>
            <p className="text-muted-foreground">Record and review daily presence.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExport} disabled={!records?.length}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Button onClick={() => setShowBulkUpload(true)} disabled={!selectedBatch}>
              <Upload className="mr-2 h-4 w-4" />
              Bulk Upload
            </Button>
          </div>
        </div>

        <BulkUploadDialog
          open={showBulkUpload}
          onClose={() => setShowBulkUpload(false)}
          batchId={selectedBatch}
          date={date}
        />

        <Card className="bg-muted/30 border-dashed">
          <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Select Batch</label>
              <Select value={selectedBatch} onValueChange={v => { setSelectedBatch(v); setRosterLoaded(false); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a running batch" />
                </SelectTrigger>
                <SelectContent>
                  {batches?.map(b => (
                    <SelectItem key={b.id} value={b.id.toString()}>{b.name} ({b.batchCode})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Date</label>
              <Input type="date" value={date} onChange={e => { setDate(e.target.value); setRosterLoaded(false); }} max={format(new Date(), "yyyy-MM-dd")} />
            </div>
            <div className="flex items-end">
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={!selectedBatch}
                onClick={handleLoadRoster}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                Load Roster
              </Button>
            </div>
          </CardContent>
        </Card>

        {rosterLoaded && selectedBatch ? (
          <Card className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
              <div>
                <CardTitle>Roster for {format(new Date(date + "T00:00:00"), "MMMM d, yyyy")}</CardTitle>
                <CardDescription>
                  {filteredRecords?.length || 0} record{filteredRecords?.length !== 1 ? "s" : ""} found.
                </CardDescription>
              </div>
              <div className="relative max-w-sm w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search candidate..."
                  className="pl-8 h-9"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Remarks</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading records...</TableCell>
                    </TableRow>
                  ) : filteredRecords?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-12 text-muted-foreground border-t border-dashed">
                        <p className="mb-4">No attendance records for this date.</p>
                        <Button
                          variant="outline"
                          onClick={handleInitRoster}
                          disabled={bulkCreate.isPending || !allCandidates?.length}
                        >
                          {bulkCreate.isPending ? "Initializing..." : `Initialize Roster (${allCandidates?.length ?? 0} candidates)`}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRecords?.map(record => (
                      <RosterRow key={record.id} record={record} />
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <div className="h-64 flex items-center justify-center border border-dashed rounded-lg bg-card/50 text-muted-foreground">
            Select a batch and click Load Roster to view attendance
          </div>
        )}
      </div>
    </Layout>
  );
}
