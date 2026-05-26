/**
 * Frontend API client for the autonomous batch monitoring agent.
 *
 * Why not generated? The /api/monitoring/* routes are added in this feature
 * iteration and the project's OpenAPI generator (orval) hasn't been re-run
 * to include them. To avoid touching the generated files (which would
 * conflict on every regen), we keep these as small, hand-written wrappers.
 * If/when the OpenAPI spec is updated, these can be replaced by generated
 * useQuery hooks.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "./auth";

const BASE = ""; // same-origin via Vite proxy

type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type AlertStatus = "open" | "acknowledged" | "resolved" | "dismissed";

export interface MonitoringAlert {
  id: number;
  runId: string | null;
  batchId: number | null;
  batchCode: string | null;
  batchName: string | null;
  candidateId: number | null;
  candidateName: string | null;
  assessmentId: number | null;
  alertKind: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  aiSummary: string | null;
  metricValue: string | null;
  thresholdValue: string | null;
  status: AlertStatus;
  acknowledgedBy: number | null;
  acknowledgedAt: string | null;
  resolvedBy: number | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface BatchRiskSummary {
  batchId: number;
  batchCode: string;
  batchName: string;
  program: string;
  status: string;
  coordinatorId: number | null;
  activeCandidates: number;
  attendancePct: number;
  attendanceDropPct: number;
  clearancePct: number;
  openAlerts: number;
  criticalAlerts: number;
  highAlerts: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface MonitoringConfig {
  id: number;
  attendanceBatchThresholdPct: string;
  attendanceDropThresholdPct: string;
  attendanceCandidateThresholdPct: string;
  assessmentPassThresholdPct: string;
  clearanceThresholdPct: string;
  consecutiveAbsenceDays: number;
  assessmentOverdueDays: number;
  emailTrainer: boolean;
  emailCoordinator: boolean;
  emailAdmin: boolean;
  schedulerEnabled: boolean;
  schedulerCron: string;
  updatedAt: string;
}

export interface EmailLogEntry {
  id: number;
  alertId: number | null;
  recipientEmail: string;
  recipientRole: string | null;
  subject: string;
  body: string;
  status: string;
  provider: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface BatchRiskDetail {
  batch: { id: number; batchCode: string; name: string; program: string; status: string; coordinatorId: number | null };
  summary: Omit<BatchRiskSummary, "batchId" | "batchCode" | "batchName" | "program" | "status" | "coordinatorId"> | null;
  alerts: MonitoringAlert[];
}

export interface MonitorRunResult {
  runId: string;
  batchesScanned: number;
  alertsCreated: number;
  emailsSent: number;
  perBatch: Array<{
    batchId: number;
    batchCode: string;
    batchName: string;
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    attendancePct: number;
    attendanceDropPct: number;
    clearancePct: number;
    alertsCreated: number;
    newAlerts: { kind: string; severity: string; title: string }[];
    aiSummary: string;
  }>;
  digest: string;
}

async function fetchJson<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const r = await fetch(`${BASE}${url}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  if (!r.ok) {
    const err: { status: number; message: string } = {
      status: r.status,
      message: `HTTP ${r.status}: ${await r.text()}`,
    };
    throw err;
  }
  return r.json();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useMonitoringAlerts(params?: { status?: AlertStatus; severity?: AlertSeverity; kind?: string; batchId?: number }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.severity) qs.set("severity", params.severity);
  if (params?.kind) qs.set("kind", params.kind);
  if (params?.batchId) qs.set("batchId", String(params.batchId));
  const url = `/api/monitoring/alerts${qs.toString() ? `?${qs}` : ""}`;
  return useQuery<MonitoringAlert[]>({
    queryKey: ["monitoring", "alerts", params],
    queryFn: () => fetchJson<MonitoringAlert[]>(url),
  });
}

export function useBatchRiskSummaries() {
  return useQuery<BatchRiskSummary[]>({
    queryKey: ["monitoring", "batch-risk"],
    queryFn: () => fetchJson<BatchRiskSummary[]>(`/api/monitoring/batch-risk`),
  });
}

export function useBatchRiskDetail(batchId: number | null) {
  return useQuery<BatchRiskDetail>({
    queryKey: ["monitoring", "batch-risk", batchId],
    enabled: batchId != null,
    queryFn: () => fetchJson<BatchRiskDetail>(`/api/monitoring/batch-risk/${batchId}`),
  });
}

export function useMonitoringConfig() {
  return useQuery<MonitoringConfig>({
    queryKey: ["monitoring", "config"],
    queryFn: () => fetchJson<MonitoringConfig>(`/api/monitoring/config`),
  });
}

export function useMonitoringEmailLog() {
  return useQuery<EmailLogEntry[]>({
    queryKey: ["monitoring", "email-log"],
    queryFn: () => fetchJson<EmailLogEntry[]>(`/api/monitoring/email-log`),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useUpdateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: "acknowledge" | "resolve" | "dismiss" }) =>
      fetchJson<MonitoringAlert>(`/api/monitoring/alerts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitoring"] });
    },
  });
}

export function useRunMonitoringScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<MonitorRunResult>(`/api/monitoring/run`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitoring"] });
    },
  });
}

export function useUpdateMonitoringConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<MonitoringConfig>) =>
      fetchJson<MonitoringConfig>(`/api/monitoring/config`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitoring", "config"] });
    },
  });
}
