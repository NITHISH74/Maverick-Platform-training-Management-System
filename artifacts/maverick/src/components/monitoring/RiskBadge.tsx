import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const STYLES: Record<RiskLevel, string> = {
  LOW: "bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300",
  MEDIUM: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-300",
  HIGH: "bg-orange-100 text-orange-800 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-300",
  CRITICAL: "bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300",
};

export function RiskBadge({ level, className }: { level: RiskLevel; className?: string }) {
  return (
    <Badge variant="secondary" className={cn(STYLES[level], "font-semibold", className)}>
      {level}
    </Badge>
  );
}
