/**
 * Settings modal for per-batch clearance threshold (Feature 1.D).
 * PATCH /api/batches/:id/clearance-rate { clearance_rate: number }
 */

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  batchId: number | null;
  batchName: string;
  currentRate: number;
  onClose: () => void;
  onSaved: () => void;
}

export function ClearanceModal({ open, batchId, batchName, currentRate, onClose, onSaved }: Props) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [rate, setRate] = useState(currentRate);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setRate(currentRate); }, [currentRate, open]);

  async function save() {
    if (!token || batchId == null) return;
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast({ title: "Invalid value", description: "Clearance rate must be 0–100.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`/api/batches/${batchId}/clearance-rate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clearance_rate: rate }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      toast({ title: "Clearance rate updated", description: `${batchName} → ${rate.toFixed(0)}%` });
      onSaved();
      onClose();
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Clearance Rate — {batchName}</DialogTitle>
          <DialogDescription>
            Set the minimum passing score (%) the batch must hit on assessments. Candidates whose latest
            score is below this threshold count toward "Not Cleared".
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="clearance-input">Minimum passing score (%)</Label>
          <Input
            id="clearance-input"
            type="number"
            min={0}
            max={100}
            value={Number.isFinite(rate) ? rate : ""}
            onChange={(e) => setRate(Number(e.target.value))}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
