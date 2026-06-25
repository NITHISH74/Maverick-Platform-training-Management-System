import { useState, useRef, useEffect } from "react";
import { useListCandidates, useListBatches, useBulkImportCandidates } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableSkeletonRows } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Search, Upload, Download, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

interface CsvCandidate {
  candidateId: string;
  name: string;
  email: string;
  phone?: string;
  college?: string;
  degree?: string;
}

function downloadDuplicatesCsv(rows: { row: number; name: string; email?: string; reason: string }[]) {
  const lines = [
    ["Row", "Name", "Email", "Reason"],
    ...rows.map(r => [String(r.row), r.name, r.email ?? "", r.reason]),
  ];
  const csv = lines.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bulk_import_duplicates_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCsv(text: string): CsvCandidate[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());
  return lines.slice(1).map(line => {
    const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = cols[i] ?? ""; });
    return {
      candidateId: obj["candidateid"] || obj["candidate_id"] || obj["id"] || "",
      name: obj["name"] || obj["fullname"] || obj["full_name"] || "",
      email: obj["email"] || "",
      phone: obj["phone"] || obj["mobile"] || undefined,
      college: obj["college"] || obj["institution"] || undefined,
      degree: obj["degree"] || obj["qualification"] || undefined,
    };
  }).filter(c => c.candidateId && c.name && c.email);
}

function BulkImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: batches } = useListBatches();
  const bulkImport = useBulkImportCandidates();
  const fileRef = useRef<HTMLInputElement>(null);

  const [batchId, setBatchId] = useState("");
  const [parsed, setParsed] = useState<CsvCandidate[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{
    inserted: number;
    failed: number;
    errors: string[];
    duplicates?: { row: number; name: string; email?: string; reason: string }[];
  } | null>(null);
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
      const rows = parseCsv(text);
      setParsed(rows);
      setFileError(rows.length === 0 ? "No valid rows found. Ensure columns: candidateId, name, email" : null);
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const csv = "candidateId,name,email,phone,college,degree\nCAN001,John Doe,john@example.com,9876543210,MIT,B.Tech";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport() {
    if (!batchId || parsed.length === 0) return;
    setMutError(null);
    bulkImport.mutate(
      { data: { batchId: Number(batchId), candidates: parsed } },
      {
        onSuccess: (data) => {
          // Server returns `duplicates` in addition to inserted/failed/errors.
          // The generated TS type doesn't know about it yet, so cast.
          setResult(data as typeof result);
          queryClient.invalidateQueries({ queryKey: ["listCandidates"] });
        },
        onError: (err: unknown) => {
          setMutError(err instanceof Error ? err.message : "Import failed.");
        },
      }
    );
  }

  function handleClose() {
    setBatchId("");
    setParsed([]);
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
          <DialogTitle>Bulk Import Candidates</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Upload a CSV to import multiple candidates into a batch.</p>
            <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate} className="gap-2 shrink-0">
              <Download className="h-3.5 w-3.5" />
              Template
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label>Target Batch</Label>
            <Select value={batchId} onValueChange={setBatchId}>
              <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
              <SelectContent>
                {batches?.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
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
                <p className="text-sm font-medium">{fileName} — {parsed.length} valid rows</p>
              ) : (
                <p className="text-sm text-muted-foreground">Click to select CSV file</p>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>
          {fileError && <p className="text-sm text-destructive">{fileError}</p>}
          {mutError && <p className="text-sm text-destructive">{mutError}</p>}
          {result && (
            <div className="rounded-md border p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span>{result.inserted} inserted successfully</span>
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
              {result.duplicates && result.duplicates.length > 0 && (
                <div className="rounded-md border border-yellow-400/60 bg-yellow-50 dark:bg-yellow-950/30 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-yellow-700 dark:text-yellow-300">
                      <AlertTriangle className="h-4 w-4" />
                      {result.duplicates.length} duplicate entr{result.duplicates.length === 1 ? "y" : "ies"} were skipped
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5"
                      onClick={() => downloadDuplicatesCsv(result.duplicates ?? [])}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download Duplicates Report
                    </Button>
                  </div>
                  <div className="max-h-48 overflow-auto rounded border bg-background">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Row</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.duplicates.map((d, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{d.row}</TableCell>
                            <TableCell className="text-sm">{d.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{d.email ?? ""}</TableCell>
                            <TableCell className="text-xs">{d.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>Close</Button>
          {!result && (
            <Button type="button" onClick={handleImport} disabled={!batchId || parsed.length === 0 || bulkImport.isPending}>
              {bulkImport.isPending ? "Importing..." : `Import ${parsed.length} Candidates`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Candidates() {
  const { data: candidates, isLoading } = useListCandidates();
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);

  // F3: auto-open the Bulk Import dialog when navigated here from the
  // Batches page with ?openBulkImport=true. We clear the query param after
  // opening so a manual refresh doesn't keep re-triggering it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("openBulkImport") === "true") {
      setShowImport(true);
      url.searchParams.delete("openBulkImport");
      window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
    }
  }, []);

  const filtered = candidates?.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.candidateId ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (c.batchName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Candidates</h1>
            <p className="text-muted-foreground">Directory of all program participants.</p>
          </div>
          <Button onClick={() => setShowImport(true)} variant="outline" size="sm" className="gap-2">
            <Upload className="h-3.5 w-3.5" />
            Bulk Import
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <label htmlFor="candidate-search" className="sr-only">Search candidates</label>
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="candidate-search"
                  type="search"
                  placeholder="Search candidates..."
                  className="pl-8"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <span className="text-sm text-muted-foreground">{filtered?.length ?? 0} results</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableSkeletonRows columns={5} rows={5} />
                ) : filtered && filtered.length > 0 ? (
                  filtered.map((candidate) => (
                    <TableRow key={candidate.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="font-mono text-sm">{candidate.candidateId}</TableCell>
                      <TableCell className="font-medium">{candidate.name}</TableCell>
                      <TableCell>{candidate.batchName}</TableCell>
                      <TableCell><StatusBadge status={candidate.status} /></TableCell>
                      <TableCell className="text-right">
                        <Link href={`/candidates/${candidate.id}`} className="text-primary hover:underline text-sm font-medium">
                          View Profile
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      {search ? "No candidates match your search." : "No candidates found."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <BulkImportDialog open={showImport} onClose={() => setShowImport(false)} />
      </div>
    </Layout>
  );
}
