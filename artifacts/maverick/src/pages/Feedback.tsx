import { useMemo, useState } from "react";
import { useListFeedback, useListBatches } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Download, Mail } from "lucide-react";

const DEFAULT_BODY =
  "Dear [Candidate Name],\n\n" +
  "Please fill out the feedback form for [Batch Name] using the link below:\n" +
  "[MS_FORMS_LINK]\n\n" +
  "Due by: [DUE_DATE] at [DUE_TIME]\n\n" +
  "Thank you.";

async function fetchAuthed(path: string, init: RequestInit = {}) {
  const token = localStorage.getItem("token") ?? "";
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

function SendFeedbackDialog({
  open,
  onClose,
  batchId,
  batchName,
}: {
  open: boolean;
  onClose: () => void;
  batchId: number;
  batchName: string;
}) {
  const { toast } = useToast();
  const [subject, setSubject] = useState(`Feedback Request — ${batchName}`);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [msLink, setMsLink] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("17:00");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!msLink.trim()) {
      toast({ title: "Missing MS Forms link", description: "Paste your MS Forms URL before sending.", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const res = await fetchAuthed("/api/feedback/send-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_id: batchId,
          subject,
          body,
          ms_forms_link: msLink,
          due_date: dueDate || null,
          due_time: dueTime || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast({
        title: "Feedback request sent",
        description: `Emailed ${data.sent} of ${data.candidates} candidate(s) in ${batchName}.`,
      });
      onClose();
    } catch (e) {
      toast({ title: "Send failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Send Feedback Request</DialogTitle>
          <DialogDescription>
            Email every active candidate in <strong>{batchName}</strong> with the MS Forms link below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label>Batch</Label>
            <Input value={batchName} readOnly disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <textarea
              className="w-full min-h-[160px] rounded-md border bg-background p-2 text-sm font-mono"
              value={body}
              onChange={e => setBody(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Placeholders <code>[Candidate Name]</code>, <code>[Batch Name]</code>, <code>[MS_FORMS_LINK]</code>, <code>[DUE_DATE]</code>, <code>[DUE_TIME]</code> are replaced on send.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>MS Forms link *</Label>
            <Input
              placeholder="https://forms.office.com/r/..."
              value={msLink}
              onChange={e => setMsLink(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Due time</Label>
              <Input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? "Sending…" : "Send to all candidates"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function downloadFeedback(batchId: number, batchName: string) {
  const res = await fetchAuthed(`/api/feedback/download/${batchId}`);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = batchName.replace(/[^a-z0-9_\-]+/gi, "_");
  a.download = `feedback_${safe}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Feedback() {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "coordinator";
  const { data: feedback, isLoading } = useListFeedback();
  const { data: batches } = useListBatches();
  const [sendDialog, setSendDialog] = useState<{ batchId: number; batchName: string } | null>(null);

  // Only show "send" controls for active (non-closed) batches the user can act on.
  const actionableBatches = useMemo(
    () => (batches ?? []).filter(b => b.status !== "closed"),
    [batches],
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Feedback</h1>
            <p className="text-muted-foreground">Candidate feedback and sentiment analysis.</p>
          </div>
        </div>

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle>Batches</CardTitle>
              <CardDescription>Send feedback requests or download collected responses per batch.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch</TableHead>
                    <TableHead>Program</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {actionableBatches.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                        No active batches.
                      </TableCell>
                    </TableRow>
                  ) : actionableBatches.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{b.program}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="uppercase text-[10px]">{b.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => setSendDialog({ batchId: b.id, batchName: b.name })}>
                          <Mail className="mr-1.5 h-3.5 w-3.5" />
                          Send Feedback Request
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => downloadFeedback(b.id, b.name)}>
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          Download Feedback
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Recent Responses</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Content Rating</TableHead>
                  <TableHead>Trainer Rating</TableHead>
                  <TableHead>Sentiment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                   <TableRow>
                     <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading feedback...</TableCell>
                   </TableRow>
                 ) : feedback?.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.batchName}</TableCell>
                    <TableCell>{item.candidateName || "Anonymous"}</TableCell>
                    <TableCell>{item.contentRating} / 5</TableCell>
                    <TableCell>{item.trainerRating} / 5</TableCell>
                    <TableCell>
                      {item.sentiment && (
                        <Badge variant="outline" className={
                          item.sentiment === 'positive' ? 'border-green-500 text-green-500' :
                          item.sentiment === 'negative' ? 'border-destructive text-destructive' : ''
                        }>
                          {item.sentiment}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {sendDialog && (
        <SendFeedbackDialog
          open
          onClose={() => setSendDialog(null)}
          batchId={sendDialog.batchId}
          batchName={sendDialog.batchName}
        />
      )}
    </Layout>
  );
}
