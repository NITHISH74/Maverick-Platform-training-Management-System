import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { RiskBadge } from "./RiskBadge";
import { TrendingDown, TrendingUp, Users } from "lucide-react";
import type { BatchRiskSummary } from "@/lib/monitoring-api";

export function BatchRiskCard({ summary }: { summary: BatchRiskSummary }) {
  const trendIcon = summary.attendanceDropPct > 0 ? <TrendingDown className="h-3 w-3 text-orange-500" /> : <TrendingUp className="h-3 w-3 text-green-500" />;
  return (
    <Link href={`/monitoring/batch/${summary.batchId}`}>
      <Card className="hover:border-primary/50 transition cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">{summary.batchCode}</CardTitle>
            <RiskBadge level={summary.riskLevel} />
          </div>
          <p className="text-xs text-muted-foreground truncate">{summary.batchName}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Attendance (14d)</span>
              <span className="font-medium">{summary.attendancePct.toFixed(1)}%</span>
            </div>
            <Progress value={summary.attendancePct} className="h-1.5" />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Clearance</span>
              <span className="font-medium">{summary.clearancePct.toFixed(1)}%</span>
            </div>
            <Progress value={summary.clearancePct} className="h-1.5" />
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t">
            <div>
              <Users className="h-3 w-3 inline mr-1 text-muted-foreground" />
              <span className="font-medium">{summary.activeCandidates}</span>
            </div>
            <div className="flex items-center gap-1">
              {trendIcon}
              <span className="font-medium">{summary.attendanceDropPct.toFixed(1)}%</span>
            </div>
            <div className="text-right">
              <span className="font-medium text-orange-600">{summary.openAlerts}</span>
              <span className="text-muted-foreground"> alerts</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
