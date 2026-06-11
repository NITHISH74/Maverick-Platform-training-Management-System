/**
 * Plain-text email templates for the autonomous batch monitoring agent.
 *
 * Each template returns { subject, body }. Templates are intentionally
 * plain text (not HTML) so they render the same in every email client and
 * are easy to assert against in tests / demos.
 *
 * Adding a new template:
 *   1. Add a `case` in `renderMonitoringEmail`.
 *   2. The `kind` string must match an `alert_kind` from the migration.
 */

export interface EmailRenderInput {
  kind: string;
  recipientName: string;
  recipientRole: string; // 'trainer' | 'coordinator' | 'admin'
  batchCode: string;
  batchName: string;
  candidateName?: string | null;
  metric?: number | null; // the trigger value (e.g. attendance %, score %)
  threshold?: number | null;
  aiSummary?: string | null;
  detail?: string | null;
}

export interface RenderedEmail {
  subject: string;
  body: string;
}

const SIGN_OFF = "\n— Maverick Monitoring Agent\nThis is an automated alert. Reply via the platform to acknowledge or resolve.";

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  return `${Number(n).toFixed(digits)}%`;
}

export function renderMonitoringEmail(input: EmailRenderInput): RenderedEmail {
  const { kind, recipientName, batchCode, batchName, candidateName, metric, threshold, aiSummary } = input;
  const greet = `Hi ${recipientName || "there"},\n\n`;
  const tail = aiSummary ? `\n\nAI summary: ${aiSummary}` : "";

  switch (kind) {
    case "attendance_not_uploaded":
      return {
        subject: `[Maverick] ${batchCode} — Attendance not uploaded`,
        body:
          `${greet}Attendance for batch ${batchCode} (${batchName}) has not been uploaded ` +
          `before today's cutoff. Please mark attendance in the Maverick dashboard at your earliest.` +
          tail + SIGN_OFF,
      };

    case "attendance_drop":
      return {
        subject: `[Maverick] ${batchCode} — Attendance dropped ${pct(metric)} this week`,
        body:
          `${greet}Batch ${batchCode} (${batchName}) attendance has dropped by ${pct(metric)} ` +
          `compared to the previous week. The drop threshold is ${pct(threshold)}. ` +
          `Please review and consider intervention.` +
          tail + SIGN_OFF,
      };

    case "low_attendance_pct":
      return {
        subject: `[Maverick] ${batchCode} — Low attendance (${pct(metric)})`,
        body:
          `${greet}Batch ${batchCode} (${batchName}) is at ${pct(metric)} attendance ` +
          `over the last 14 days, below the configured threshold of ${pct(threshold)}.` +
          tail + SIGN_OFF,
      };

    case "continuous_absence":
      return {
        subject: `[Maverick] ${batchCode} — ${candidateName} absent 3+ days`,
        body:
          `${greet}${candidateName || "A candidate"} in batch ${batchCode} (${batchName}) ` +
          `has been absent for 3 or more consecutive days. ` +
          `Please follow up directly with the candidate.` +
          tail + SIGN_OFF,
      };

    case "low_individual_attendance":
      return {
        subject: `[Maverick] ${batchCode} — Low attendance: ${candidateName} (${pct(metric)})`,
        body:
          `${greet}${candidateName || "A candidate"} in batch ${batchCode} (${batchName}) ` +
          `has attendance of ${pct(metric)}, below the per-candidate threshold of ${pct(threshold)}. ` +
          `Please reach out for a check-in.` +
          tail + SIGN_OFF,
      };

    case "low_assessment_marks":
      return {
        subject: `[Maverick] ${batchCode} — ${candidateName} scored ${pct(metric)} on latest assessment`,
        body:
          `${greet}${candidateName || "A candidate"} in batch ${batchCode} (${batchName}) ` +
          `scored ${pct(metric)} on their most recent assessment, below the ${pct(threshold)} pass threshold. ` +
          `Consider remedial coaching.` +
          tail + SIGN_OFF,
      };

    case "low_clearance_rate":
      return {
        subject: `[Maverick] ${batchCode} — HIGH RISK: clearance rate ${pct(metric)}`,
        body:
          `${greet}Batch ${batchCode} (${batchName}) clearance rate is ${pct(metric)}, ` +
          `below the ${pct(threshold)} threshold. This batch has been flagged HIGH RISK.` +
          tail + SIGN_OFF,
      };

    case "assessment_overdue":
      return {
        subject: `[Maverick] ${batchCode} — Assessment overdue`,
        body:
          `${greet}An assessment for batch ${batchCode} (${batchName}) is past its scheduled date ` +
          `and has not been uploaded. Please upload the scores or reschedule the assessment.` +
          tail + SIGN_OFF,
      };

    default:
      return {
        subject: `[Maverick] ${batchCode} — Monitoring alert`,
        body: `${greet}A monitoring alert was raised for batch ${batchCode} (${batchName}).` + tail + SIGN_OFF,
      };
  }
}
