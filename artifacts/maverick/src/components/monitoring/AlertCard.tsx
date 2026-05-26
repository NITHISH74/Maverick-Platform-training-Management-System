import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "./RiskBadge";
import { AlertTriangle, Calendar, User, Check, X, Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { MonitoringAlert } from "@/lib/monitoring-api";
import { useUpdateAlert } from "@/lib/monitoring-api";

// Map alert kinds → user-friendly labels. Keeping this dict close to the
// component (vs. server-side) means we can iterate on copy without redeploys.
const KIND_LABEL: Record<string, string> = {
  attendance_not_uploaded: "Attendance not uploaded",
  attendance_drop: "Attendance dropped",
  low_attendance_pct: "Low batch attendance",
  continuous_absence: "3+ days absent",
  low_individual_attendance: "Low candidate attendance",
  low_assessment_marks: "Low assessment score",
  low_clearance_rate: "Low clearance rate",
  assessment_overdue: "Assessment overdue",
};

export function AlertCard({ alert, compact = false }: { alert: MonitoringAlert; compact?: boolean }) {
  const update = useUpdateAlert();

  const handleAction = (action: "acknowledge" | "resolve" | "dismiss") => {
    update.mutate({ id: alert.id, action });
  };

  return (
    <Card className={alert.status === "open" ? "border-l-4 border-l-orange-500" : "opacity-75"}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
            </div>
            <div className="space-y-1 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <RiskBadge level={alert.severity} />
                <span className="text-xs text-muted-foreground">{KIND_LABEL[alert.alertKind] ?? alert.alertKind}</span>
              </div>
              <p className="font-medium text-sm leading-tight">{alert.title}</p>
              {!compact && (
                <p className="text-sm text-muted-foreground">{alert.message}</p>
              )}
              {alert.aiSummary && !compact && (
                <p className="text-xs italic text-muted-foreground border-l-2 border-muted pl-2 mt-2">
                  {alert.aiSummary}
                </p>
              )}
            </div>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {alert.batchCode && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {alert.batchCode}
            </span>
          )}
          {alert.candidateName && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {alert.candidateName}
            </span>
          )}
        </div>

        {alert.status === "open" && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => handleAction("acknowledge")} disabled={update.isPending}>
              <Eye className="h-3 w-3 mr-1" />
              Acknowledge
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleAction("resolve")} disabled={update.isPending}>
              <Check className="h-3 w-3 mr-1" />
              Resolve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handleAction("dismiss")} disabled={update.isPending}>
              <X className="h-3 w-3 mr-1" />
              Dismiss
            </Button>
          </div>
        )}
        {alert.status !== "open" && (
          <p className="text-xs text-muted-foreground capitalize">Status: {alert.status}</p>
        )}
      </CardContent>
    </Card>
  );
}
