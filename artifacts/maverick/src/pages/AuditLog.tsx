import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Filter, RotateCcw, Activity } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { TableSkeletonRows } from "@/components/ui/table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Render an audit log's details cell as a sentence rather than the raw JSON
 * blob. F2 introduced the {before, after, role, ip} shape — this knows how
 * to summarise it. Falls back to the raw string for older rows.
 */
function formatDetails(action: string, details: string | null | undefined): string {
  if (!details) return "";
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(details) as Record<string, unknown>;
  } catch {
    return details;
  }
  if (action.startsWith("copilot.")) {
    const q = typeof parsed?.query === "string" ? parsed.query : null;
    const rows = typeof parsed?.row_count === "number" ? parsed.row_count : null;
    const denied = Array.isArray(parsed?.denied_batches) ? (parsed!.denied_batches as unknown[]) : null;
    if (denied && denied.length > 0) return `Denied batches ${denied.join(", ")}; query: "${q ?? ""}"`;
    if (q && rows != null) return `"${q}" — ${rows} row(s)`;
    if (q) return `"${q}"`;
    return "(Copilot)";
  }
  if (parsed && typeof parsed.summary === "string") return parsed.summary;
  // F2-shape: surface a compact "field: a→b" line for the first changed field.
  const before = (parsed?.before as Record<string, unknown> | null) ?? null;
  const after = (parsed?.after as Record<string, unknown> | null) ?? null;
  if (before && after) {
    const changed: string[] = [];
    for (const k of Object.keys(after)) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
        changed.push(`${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`);
      }
    }
    if (changed.length > 0) return changed.slice(0, 2).join(" · ");
  }
  if (after) return `Created: ${Object.entries(after).slice(0, 3).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`;
  if (before) return `Removed: ${Object.entries(before).slice(0, 3).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`;
  return details;
}

interface AuditRow {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  actorId: number | null;
  actorName: string | null;
  actorRole: string | null;
  details: string | null;
  createdAt: string;
}

interface AuditPage {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  actions: string[];
  actors: { id: number; name: string; role: string }[];
}

const PAGE_SIZE = 50;

// Map entity_type → in-app route so entity_id can become a clickable link.
const ENTITY_LINKS: Record<string, (id: number) => string> = {
  batch: id => `/batches/${id}`,
  candidate: id => `/candidates/${id}`,
  assessment: id => `/assessments`,
  user: id => `/users`,
  topper_config: () => `/settings`,
};

export default function AuditLog() {
  const { token } = useAuth();
  const [data, setData] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Filters
  const [action, setAction] = useState<string>("");
  const [actorId, setActorId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  // Refetch when filters or page change. Debounce on dates so typing in the
  // input doesn't spam the API; the Select dropdowns fire one event each.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    if (action) params.set("action", action);
    if (actorId) params.set("actorId", actorId);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    fetch(`/api/audit-logs?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        return (await r.json()) as AuditPage;
      })
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, page, action, actorId, startDate, endDate]);

  // When filters change, jump back to page 1 — otherwise you can land on
  // page 7 of a 1-page filtered result and see nothing.
  useEffect(() => { setPage(1); }, [action, actorId, startDate, endDate]);

  const hasActiveFilters = !!(action || actorId || startDate || endDate);

  const resetFilters = () => {
    setAction("");
    setActorId("");
    setStartDate("");
    setEndDate("");
  };

  const actionsForDropdown = useMemo(() => data?.actions ?? [], [data]);
  const actorsForDropdown = useMemo(() => data?.actors ?? [], [data]);

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground">System-wide activity timeline.</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filters
                </CardTitle>
                <CardDescription>Narrow down events by type, person, or date range.</CardDescription>
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  <RotateCcw className="h-3.5 w-3.5 mr-2" />
                  Reset
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Action</label>
                <Select value={action || "_all"} onValueChange={v => setAction(v === "_all" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All actions" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value="_all">All actions</SelectItem>
                    {actionsForDropdown.map(a => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Performed by</label>
                <Select value={actorId || "_all"} onValueChange={v => setActorId(v === "_all" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Anyone" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value="_all">Anyone</SelectItem>
                    {actorsForDropdown.map(a => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name} ({a.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">From</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">To</label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
            <div>
              <CardTitle>Events</CardTitle>
              <CardDescription>
                {data ? `${data.total} total event${data.total === 1 ? "" : "s"}` : "—"}
              </CardDescription>
            </div>
            {data && data.total > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="tabular-nums">Page {page} of {totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-44">Timestamp</TableHead>
                  <TableHead className="w-48">Action</TableHead>
                  <TableHead className="w-40">Entity</TableHead>
                  <TableHead className="w-44">Performed by</TableHead>
                  <TableHead className="w-24">Role</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={6} rows={6} />
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-destructive text-sm">
                      Failed to load audit log: {error}
                    </TableCell>
                  </TableRow>
                ) : !data || data.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState
                        icon={Activity}
                        title="No matching events"
                        description={
                          hasActiveFilters
                            ? "Try widening the date range or clearing filters."
                            : "Activity will appear here as users create, update, and delete records."
                        }
                        action={hasActiveFilters ? { label: "Clear filters", onClick: resetFilters } : undefined}
                      />
                    </TableCell>
                  </TableRow>
                ) : data.rows.map(log => {
                  const linkBuilder = ENTITY_LINKS[log.entityType];
                  const entityCell = log.entityId != null
                    ? (linkBuilder
                        ? <Link href={linkBuilder(log.entityId)} className="hover:underline">
                            {log.entityType} #{log.entityId}
                          </Link>
                        : <span>{log.entityType} #{log.entityId}</span>)
                    : <span>{log.entityType}</span>;
                  return (
                    <TableRow key={log.id} className="hover:bg-muted/50">
                      <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                        {format(new Date(log.createdAt), "MMM d, yyyy HH:mm:ss")}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs px-2 py-1 bg-muted rounded-md">{log.action}</span>
                      </TableCell>
                      <TableCell className="text-sm">{entityCell}</TableCell>
                      <TableCell className="text-sm">{log.actorName ?? "System"}</TableCell>
                      <TableCell className="text-xs uppercase tracking-wide text-muted-foreground">
                        {log.actorRole ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-md break-words">
                        {formatDetails(log.action, log.details)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
