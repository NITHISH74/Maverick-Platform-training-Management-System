import { useListAuditLogs } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

/**
 * Render an audit log's details cell as a sentence rather than the raw
 * JSON blob. Mirrors the formatter in `api-server/src/routes/dashboard.ts`
 * — kept client-side because the legacy /audit-logs endpoint returns
 * `details` as-is.
 */
function formatDetails(action: string, details: string | null | undefined): string {
  if (!details) return "";
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(details) as Record<string, unknown>;
  } catch {
    return details; // not JSON — show as-is
  }
  if (action.startsWith("copilot.")) {
    const q = typeof parsed?.query === "string" ? parsed.query : null;
    const rows = typeof parsed?.row_count === "number" ? parsed.row_count : null;
    if (q && rows != null) return `"${q}" — ${rows} row(s)`;
    if (q) return `"${q}"`;
    return "(Copilot)";
  }
  if (parsed && typeof parsed.summary === "string") return parsed.summary;
  return details;
}

export default function AuditLog() {
  const { data: logs, isLoading } = useListAuditLogs();

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
            <p className="text-muted-foreground">System-wide activity timeline.</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                   <TableRow>
                     <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading logs...</TableCell>
                   </TableRow>
                 ) : logs?.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap text-sm">
                      {format(new Date(log.createdAt), "MMM d, HH:mm:ss")}
                    </TableCell>
                    <TableCell className="font-medium">{log.actorName || "System"}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs px-2 py-1 bg-muted rounded-md">{log.action}</span>
                    </TableCell>
                    <TableCell>{log.entityType} {log.entityId ? `#${log.entityId}` : ''}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-md break-words">
                      {formatDetails(log.action, log.details)}
                    </TableCell>
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
