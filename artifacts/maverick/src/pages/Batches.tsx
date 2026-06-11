import { useState } from "react";
import { useListBatches, useCreateBatch, useListUsers } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/useAuth";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useLocation } from "wouter";
import { Users, Calendar, ArrowRight, Plus, Upload, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

function CreateBatchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const createBatch = useCreateBatch();
  const { data: users } = useListUsers();
  const coordinators = users?.filter(u => u.role === "coordinator") ?? [];
  const trainers = users?.filter(u => u.role === "trainer") ?? [];

  const [form, setForm] = useState({
    name: "",
    program: "",
    startDate: "",
    endDate: "",
    capacity: "30",
    coordinatorId: "",
  });
  const [trainerIds, setTrainerIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  const toggleTrainer = (id: number) => {
    setTrainerIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name || !form.program || !form.startDate || !form.endDate) {
      setError("Name, program, start date, and end date are required.");
      return;
    }
    createBatch.mutate(
      {
        data: {
          name: form.name,
          program: form.program,
          startDate: form.startDate,
          endDate: form.endDate,
          capacity: parseInt(form.capacity) || 30,
          coordinatorId: form.coordinatorId ? parseInt(form.coordinatorId) : undefined,
          trainerIds: trainerIds.length > 0 ? trainerIds : undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["listBatches"] });
          onClose();
          setForm({ name: "", program: "", startDate: "", endDate: "", capacity: "30", coordinatorId: "" });
          setTrainerIds([]);
        },
        onError: (err: unknown) => {
          setError(err instanceof Error ? err.message : "Failed to create batch.");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Batch</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Batch Name *</Label>
              <Input placeholder="e.g. Java Fullstack Q3" value={form.name} onChange={set("name")} />
            </div>
            <div className="space-y-1.5">
              <Label>Program *</Label>
              <Input placeholder="e.g. Java, Python, DevOps" value={form.program} onChange={set("program")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Start Date *</Label>
              <Input type="date" value={form.startDate} onChange={set("startDate")} />
            </div>
            <div className="space-y-1.5">
              <Label>End Date *</Label>
              <Input type="date" value={form.endDate} onChange={set("endDate")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Capacity</Label>
              <Input type="number" min="1" value={form.capacity} onChange={set("capacity")} />
            </div>
            <div className="space-y-1.5">
              <Label>Coordinator</Label>
              <Select value={form.coordinatorId} onValueChange={v => setForm(f => ({ ...f, coordinatorId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Assign coordinator" />
                </SelectTrigger>
                <SelectContent>
                  {coordinators.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Assign Trainers (optional — can be set later)</Label>
            <div className="max-h-32 overflow-y-auto border rounded-md p-2 space-y-1">
              {trainers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No trainers found.</p>
              ) : trainers.map(t => (
                <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5">
                  <input
                    type="checkbox"
                    checked={trainerIds.includes(t.id)}
                    onChange={() => toggleTrainer(t.id)}
                    className="h-4 w-4"
                  />
                  <span>{t.name}</span>
                  <span className="text-xs text-muted-foreground">({t.email})</span>
                </label>
              ))}
            </div>
            {trainerIds.length > 0 && (
              <p className="text-xs text-muted-foreground">{trainerIds.length} trainer(s) selected</p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createBatch.isPending}>
              {createBatch.isPending ? "Creating..." : "Create Batch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// F4: admin-only delete with double confirmation. Requires the admin to
// type the batch name verbatim before the Delete button enables.
function DeleteBatchDialog({
  batch, open, onClose, onDeleted,
}: {
  batch: { id: number; name: string } | null;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = !!batch && typed.trim() === batch.name;

  async function confirm() {
    if (!batch || !token || !ready) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/batches/${batch.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      toast({ title: "Batch deleted", description: `${batch.name} (soft-deleted; recoverable from DB).` });
      onDeleted();
      onClose();
      setTyped("");
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setTyped(""); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {batch?.name}?</DialogTitle>
          <DialogDescription>
            This will also remove all attendance, assessment, and feedback records for this batch.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Type the batch name to confirm.</Label>
          <Input placeholder={batch?.name ?? ""} value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setTyped(""); }} disabled={busy}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={!ready || busy}
          >
            {busy ? "Deleting…" : "Delete batch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchGrid({
  batches, onDelete, isAdmin,
}: {
  batches: Array<{ id: number; name: string; batchCode: string; status: string; candidateCount?: number | null; capacity: number; startDate: string; endDate: string }>;
  onDelete: (b: { id: number; name: string }) => void;
  isAdmin: boolean;
}) {
  if (batches.length === 0) {
    return <p className="text-center py-10 text-sm text-muted-foreground">No batches in this view.</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {batches.map((batch) => (
        <Card key={batch.id} className="flex flex-col hover-elevate transition-all group">
          <CardHeader className="pb-2 flex-row justify-between items-start space-y-0">
            <div>
              <CardTitle className="text-lg">{batch.name}</CardTitle>
              <p className="text-sm text-muted-foreground font-mono">{batch.batchCode}</p>
            </div>
            {/* F5: standardised StatusBadge — same palette across every
                page (Reports, BatchDetail, Candidates, etc.) so trainers
                don't see "running" looking different in three places. */}
            <StatusBadge status={batch.status} />
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-between">
            <div className="space-y-3 mb-6 mt-2">
              <div className="flex items-center text-sm text-muted-foreground">
                <Users className="mr-2 h-4 w-4" />
                {batch.candidateCount || 0} / {batch.capacity} candidates
              </div>
              <div className="flex items-center text-sm text-muted-foreground">
                <Calendar className="mr-2 h-4 w-4" />
                {format(new Date(batch.startDate), "MMM d")} - {format(new Date(batch.endDate), "MMM d, yyyy")}
              </div>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" className="flex-1 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <Link href={`/batches/${batch.id}`}>
                  View Details
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete batch"
                  onClick={() => onDelete({ id: batch.id, name: batch.name })}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Batches() {
  const [showCreate, setShowCreate] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState<{ id: number; name: string } | null>(null);
  const { data: batches, isLoading } = useListBatches();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const canManage = user?.role === "admin" || user?.role === "coordinator";
  const isAdmin = user?.role === "admin";

  // F5: split closed batches into a separate tab so the default view stays focused
  // on live work.
  const all = batches ?? [];
  const live = all.filter((b: any) => b.status !== "closed");
  const closed = all.filter((b: any) => b.status === "closed");

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Batches</h1>
            <p className="text-muted-foreground">
              {canManage ? "Manage and monitor all training batches." : "Your assigned batches."}
            </p>
          </div>
          {canManage && (
            <div className="flex gap-2">
              {/* F3: Bulk Import navigates to /candidates with auto-open query param. */}
              <Button variant="outline" onClick={() => navigate("/candidates?openBulkImport=true")}>
                <Upload className="mr-2 h-4 w-4" />
                Bulk Import Candidates
              </Button>
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Batch
              </Button>
            </div>
          )}
        </div>

        <CreateBatchDialog open={showCreate} onClose={() => setShowCreate(false)} />
        <DeleteBatchDialog
          batch={deletingBatch}
          open={!!deletingBatch}
          onClose={() => setDeletingBatch(null)}
          onDeleted={() => queryClient.invalidateQueries({ queryKey: ["listBatches"] })}
        />

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-4 w-1/3" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Tabs defaultValue="live">
            <TabsList>
              <TabsTrigger value="live">Live ({live.length})</TabsTrigger>
              <TabsTrigger value="closed">
                Closed
                {closed.length > 0 && <span className="ml-1.5 text-xs text-muted-foreground">({closed.length})</span>}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="live" className="pt-4">
              <BatchGrid batches={live as any} onDelete={setDeletingBatch} isAdmin={!!isAdmin} />
            </TabsContent>
            <TabsContent value="closed" className="pt-4">
              <BatchGrid batches={closed as any} onDelete={setDeletingBatch} isAdmin={!!isAdmin} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </Layout>
  );
}
