"""AI-narrated PDF reports.

Endpoint
--------
POST /reports/pdf
    Body: { report_type, rows[], filters?, batch_name? }
    Returns: application/pdf

The caller (Node /api/reports/* with ?format=pdf) fetches the report data from
Postgres exactly the way the CSV path does, then forwards the rows here. We
do NOT re-fetch from the DB in this service — it keeps the AI service stateless
and means the data the PDF describes is exactly the data the CSV would have
contained.

Pipeline
~~~~~~~~
1. Compute deterministic metrics from `rows` (counts, averages, status mix,
   percentage buckets, etc. — varies by report_type).
2. Ask Azure OpenAI for narrative sections (executive summary, insights,
   risks, recommendations), grounded ONLY on the computed metrics so the
   model has no opportunity to invent rows.
3. If the LLM call fails, fall back to a deterministic prose summary built
   from the same metrics. The PDF still ships — narrative is best-effort.
4. Render the PDF: cover page, narrative sections, then the full data table
   as an appendix.

Design notes
~~~~~~~~~~~~
* `reportlab.platypus` (the high-level "Story" API) handles pagination,
  headers, footers, and page numbers for us via a `BaseDocTemplate` subclass.
* Spec says "AI must not invent data": the LLM only sees the *metrics*
  dict, never the raw rows, and is instructed not to introduce numbers
  outside that dict. The data appendix renders from `rows` directly, so
  the table is always authoritative.
* PDF download is audit-logged on the Node side (where the user identity
  lives); this service only logs to its own stdout.
"""

from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.ai.gemini import get_llm


router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class ReportPdfIn(BaseModel):
    """Caller hands over the rows it already pulled for the CSV path."""

    report_type: str = Field(
        ...,
        description=(
            "One of 'attendance' | 'assessment' | 'topper' | 'consolidated' "
            "| 'trainer'. Drives metric calculation and column layout."
        ),
    )
    rows: list[dict[str, Any]]
    batch_name: str | None = None
    filters: dict[str, Any] | None = None
    # Optional human-readable label for the cover page (e.g. "Java-01" or
    # "All batches"); falls back to batch_name or "All batches".
    title_subtitle: str | None = None


# ---------------------------------------------------------------------------
# Metric calculators per report type
# ---------------------------------------------------------------------------


def _safe_pct(numerator: float, denominator: float) -> float:
    return round((numerator / denominator) * 100, 1) if denominator else 0.0


def _attendance_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {"total_records": 0}
    present = sum(1 for r in rows if r.get("status") == "present")
    absent = sum(1 for r in rows if r.get("status") == "absent")
    leave = sum(1 for r in rows if r.get("status") == "leave")
    total = len(rows)
    # candidates with ≥3 absences are flagged as at-risk
    absence_by_candidate: dict[str, int] = {}
    for r in rows:
        if r.get("status") == "absent":
            absence_by_candidate[r.get("candidateName", "?")] = (
                absence_by_candidate.get(r.get("candidateName", "?"), 0) + 1
            )
    at_risk = sorted(
        [{"name": n, "absences": c} for n, c in absence_by_candidate.items() if c >= 3],
        key=lambda x: -x["absences"],
    )[:10]
    return {
        "total_records": total,
        "present": present,
        "absent": absent,
        "leave": leave,
        "attendance_pct": _safe_pct(present, total),
        "at_risk_candidates": at_risk,
    }


def _assessment_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {"total_records": 0}
    pcts = [float(r.get("percentage", 0)) for r in rows]
    avg = round(sum(pcts) / len(pcts), 1)
    below_60 = sum(1 for p in pcts if p < 60)
    by_type: dict[str, list[float]] = {}
    for r in rows:
        by_type.setdefault(r.get("assessmentType", "?"), []).append(
            float(r.get("percentage", 0))
        )
    return {
        "total_records": len(rows),
        "avg_percentage": avg,
        "below_pass_count": below_60,
        "below_pass_pct": _safe_pct(below_60, len(rows)),
        "avg_by_type": {
            t: round(sum(v) / len(v), 1) for t, v in by_type.items() if v
        },
    }


def _topper_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {"total_records": 0}
    top3 = [
        {
            "rank": r.get("rank"),
            "name": r.get("candidateName"),
            "total_score": r.get("totalScore"),
        }
        for r in rows[:3]
    ]
    scores = [float(r.get("totalScore", 0)) for r in rows]
    return {
        "total_records": len(rows),
        "top3": top3,
        "score_avg": round(sum(scores) / len(scores), 1) if scores else 0,
        "score_min": min(scores) if scores else 0,
        "score_max": max(scores) if scores else 0,
    }


def _consolidated_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {"total_records": 0}
    status_mix: dict[str, int] = {}
    for r in rows:
        status_mix[r.get("status", "?")] = status_mix.get(r.get("status", "?"), 0) + 1
    att = [float(r.get("attendancePct", 0)) for r in rows]
    scores = [float(r.get("avgScore", 0)) for r in rows]
    return {
        "total_records": len(rows),
        "status_mix": status_mix,
        "attendance_avg": round(sum(att) / len(att), 1) if att else 0,
        "score_avg": round(sum(scores) / len(scores), 1) if scores else 0,
        "low_attendance_count": sum(1 for p in att if p < 75),
        "low_score_count": sum(1 for p in scores if p < 60),
    }


def _trainer_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {"total_records": 0}
    return {
        "total_records": len(rows),
        "trainer_names": list({r.get("trainerName", "?") for r in rows}),
    }


_METRIC_CALCULATORS = {
    "attendance": _attendance_metrics,
    "assessment": _assessment_metrics,
    "topper": _topper_metrics,
    "consolidated": _consolidated_metrics,
    "trainer": _trainer_metrics,
}


# ---------------------------------------------------------------------------
# Narrative generation (Azure OpenAI with deterministic fallback)
# ---------------------------------------------------------------------------


_NARRATIVE_SYSTEM = """\
You are writing a professional one-page narrative for a training-program PDF
report. You will be given a METRICS JSON computed from the report rows.

Strict rules:
- Use ONLY numbers and facts present in the METRICS JSON. If a number is not
  there, do not invent it.
- Never list individual candidates by name unless they appear in METRICS.
- Plain English, suitable for a senior coordinator. No markdown headings.
- Return STRICT JSON with exactly these keys:
  {
    "executive_summary": "1-2 short paragraphs",
    "key_insights":     ["3-5 short bullets"],
    "risks":            ["2-4 short bullets"],
    "recommendations":  ["2-4 short imperative bullets"]
  }
"""


async def _generate_narrative(
    report_type: str, metrics: dict[str, Any]
) -> dict[str, Any]:
    """LLM call; never raises — returns a deterministic stub on failure."""
    try:
        llm = get_llm(0.2)
        msg = await llm.ainvoke(
            [
                {"role": "system", "content": _NARRATIVE_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Report type: {report_type}\n"
                        f"METRICS JSON:\n{json.dumps(metrics, default=str)}\n"
                        "Return the JSON object now."
                    ),
                },
            ]
        )
        text = str(msg.content).strip()
        # Strip ```json fences if the model added them.
        for prefix in ("```json", "```JSON", "```"):
            if text.startswith(prefix):
                text = text[len(prefix):].lstrip()
        if text.endswith("```"):
            text = text[:-3].rstrip()
        parsed = json.loads(text)
        # Shape-check; missing keys get empty defaults so render doesn't blow up.
        return {
            "executive_summary": parsed.get("executive_summary", "")
            or _fallback_narrative(report_type, metrics)["executive_summary"],
            "key_insights": parsed.get("key_insights", []) or [],
            "risks": parsed.get("risks", []) or [],
            "recommendations": parsed.get("recommendations", []) or [],
            "ai_generated": True,
        }
    except Exception as e:
        print(f"[reports_pdf] narrative LLM failed, falling back: {e}")
        out = _fallback_narrative(report_type, metrics)
        out["ai_generated"] = False
        return out


def _fallback_narrative(
    report_type: str, m: dict[str, Any]
) -> dict[str, Any]:
    """Deterministic prose built from the metrics dict — used when the LLM
    call fails or the model returns invalid JSON. Same shape as the AI path."""
    if report_type == "attendance":
        att = m.get("attendance_pct", 0)
        total = m.get("total_records", 0)
        return {
            "executive_summary": (
                f"This attendance report covers {total} records. Overall "
                f"attendance is {att}%, with {m.get('present', 0)} present, "
                f"{m.get('absent', 0)} absent, and {m.get('leave', 0)} on leave."
            ),
            "key_insights": [
                f"Overall attendance: {att}%",
                f"At-risk candidates (≥3 absences): {len(m.get('at_risk_candidates', []))}",
            ],
            "risks": [
                "Attendance below 75% indicates retention risk."
                if att < 75
                else "Attendance is within healthy range."
            ],
            "recommendations": [
                "Schedule 1:1 check-ins with at-risk candidates."
                if m.get("at_risk_candidates")
                else "Maintain current attendance cadence.",
            ],
        }
    if report_type == "assessment":
        avg = m.get("avg_percentage", 0)
        return {
            "executive_summary": (
                f"This assessment report covers {m.get('total_records', 0)} "
                f"scores. The average is {avg}%, with "
                f"{m.get('below_pass_count', 0)} below 60%."
            ),
            "key_insights": [
                f"Average score: {avg}%",
                f"Below-pass rate: {m.get('below_pass_pct', 0)}%",
            ]
            + [
                f"{t}: {v}%"
                for t, v in (m.get("avg_by_type") or {}).items()
            ],
            "risks": [
                "Below-pass rate over 30% indicates a content or pacing gap."
                if m.get("below_pass_pct", 0) > 30
                else "Pass-rate distribution is acceptable."
            ],
            "recommendations": [
                "Hold remedial sessions for candidates below 60%."
                if m.get("below_pass_count", 0)
                else "Continue current assessment rhythm.",
            ],
        }
    if report_type == "topper":
        return {
            "executive_summary": (
                f"Topper report ranks {m.get('total_records', 0)} candidates "
                f"with average composite score {m.get('score_avg', 0)}."
            ),
            "key_insights": [
                f"Top performer: {(m.get('top3') or [{}])[0].get('name', 'N/A')}",
                f"Score range: {m.get('score_min', 0)}–{m.get('score_max', 0)}",
            ],
            "risks": ["Wide score spread suggests uneven preparation."]
            if (m.get("score_max", 0) - m.get("score_min", 0)) > 50
            else ["Score distribution is tight."],
            "recommendations": [
                "Pair top performers with bottom-quartile peers for review sessions.",
            ],
        }
    if report_type == "consolidated":
        return {
            "executive_summary": (
                f"Consolidated report covers {m.get('total_records', 0)} candidates. "
                f"Average attendance: {m.get('attendance_avg', 0)}%; "
                f"average score: {m.get('score_avg', 0)}%."
            ),
            "key_insights": [
                f"Status mix: {m.get('status_mix', {})}",
                f"Low attendance (<75%): {m.get('low_attendance_count', 0)}",
                f"Low score (<60%): {m.get('low_score_count', 0)}",
            ],
            "risks": [
                "Cohort attendance is below target."
                if m.get("attendance_avg", 0) < 75
                else "Cohort attendance is on track.",
                "Cohort scores are below target."
                if m.get("score_avg", 0) < 60
                else "Cohort scores are on track.",
            ],
            "recommendations": [
                "Prioritise at-risk candidates for intervention.",
            ],
        }
    return {
        "executive_summary": f"Report covers {m.get('total_records', 0)} records.",
        "key_insights": [],
        "risks": [],
        "recommendations": [],
    }


# ---------------------------------------------------------------------------
# PDF rendering
# ---------------------------------------------------------------------------


_TITLES = {
    "attendance": "Attendance Report",
    "assessment": "Assessment Report",
    "topper": "Topper Report",
    "consolidated": "Consolidated Batch Report",
    "trainer": "Trainer Report",
}


# Column layouts per report type — keys must match the JSON shape the Node
# layer hands over. (label, dict_key, width_mm)
_COLUMN_LAYOUTS: dict[str, list[tuple[str, str, int]]] = {
    "attendance": [
        ("Candidate", "candidateName", 45),
        ("Batch", "batchName", 35),
        ("Date", "date", 25),
        ("Status", "status", 20),
        ("Remarks", "remarks", 45),
    ],
    "assessment": [
        ("Candidate", "candidateName", 35),
        ("Batch", "batchName", 28),
        ("Assessment", "assessmentTitle", 35),
        ("Type", "assessmentType", 22),
        ("Score", "score", 15),
        ("Max", "maxScore", 15),
        ("%", "percentage", 12),
    ],
    "topper": [
        ("Rank", "rank", 15),
        ("Candidate", "candidateName", 45),
        ("Batch", "batchName", 35),
        ("Total", "totalScore", 18),
        ("Assess.", "assessmentScore", 18),
        ("Project", "projectScore", 18),
        ("Attend.", "attendanceScore", 18),
    ],
    "consolidated": [
        ("Cand. ID", "candidateId", 22),
        ("Candidate", "candidateName", 40),
        ("Batch", "batchName", 32),
        ("Status", "status", 22),
        ("Att. %", "attendancePct", 18),
        ("Avg %", "avgScore", 18),
    ],
    "trainer": [
        ("Trainer", "trainerName", 45),
        ("Batch", "batchName", 35),
        ("Score", "score", 20),
    ],
}


class _NumberedDocTemplate(BaseDocTemplate):
    """BaseDocTemplate variant that draws a header (title + generated-at) and
    a footer with "Page N of M" on every page. Two-pass render via
    `multiBuild` so the total page count is known on first draw."""

    def __init__(self, *args: Any, header_text: str = "", **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.header_text = header_text
        self.generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    def afterPage(self) -> None:
        # called after each page is drawn; nothing to do — see _on_page below.
        pass


def _draw_chrome(canvas: Any, doc: _NumberedDocTemplate) -> None:
    """Header/footer drawer wired into the PageTemplate."""
    canvas.saveState()
    width, height = A4

    # --- Header strip
    canvas.setFont("Helvetica-Bold", 9)
    canvas.setFillColor(colors.HexColor("#1f2937"))
    canvas.drawString(15 * mm, height - 12 * mm, "Maverick Execution Platform")
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    canvas.drawRightString(
        width - 15 * mm, height - 12 * mm, doc.header_text or ""
    )
    canvas.setStrokeColor(colors.HexColor("#e5e7eb"))
    canvas.setLineWidth(0.4)
    canvas.line(15 * mm, height - 14 * mm, width - 15 * mm, height - 14 * mm)

    # --- Footer
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    canvas.drawString(15 * mm, 10 * mm, f"Generated {doc.generated_at}")
    page_num = canvas.getPageNumber()
    canvas.drawRightString(
        width - 15 * mm, 10 * mm, f"Page {page_num}"
    )
    canvas.restoreState()


def _build_pdf(
    *,
    report_type: str,
    rows: list[dict[str, Any]],
    metrics: dict[str, Any],
    narrative: dict[str, Any],
    subtitle: str,
) -> bytes:
    buf = io.BytesIO()
    title = _TITLES.get(report_type, report_type.title())
    doc = _NumberedDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=20 * mm,
        bottomMargin=15 * mm,
        header_text=title,
    )
    frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height,
        id="body",
    )
    doc.addPageTemplates(
        [PageTemplate(id="default", frames=[frame], onPage=_draw_chrome)]
    )

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle(
        "h1",
        parent=styles["Heading1"],
        textColor=colors.HexColor("#111827"),
        fontSize=20,
        spaceAfter=4,
    )
    h2 = ParagraphStyle(
        "h2",
        parent=styles["Heading2"],
        textColor=colors.HexColor("#1f2937"),
        fontSize=13,
        spaceBefore=12,
        spaceAfter=4,
    )
    body = ParagraphStyle(
        "body",
        parent=styles["BodyText"],
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#111827"),
    )
    muted = ParagraphStyle(
        "muted",
        parent=styles["BodyText"],
        fontSize=9,
        textColor=colors.HexColor("#6b7280"),
    )
    bullet = ParagraphStyle(
        "bullet",
        parent=body,
        leftIndent=14,
        bulletIndent=2,
        spaceAfter=2,
    )

    story: list[Any] = []

    # --- Cover header
    story.append(Paragraph(title, h1))
    story.append(Paragraph(subtitle, muted))
    story.append(Spacer(1, 10))

    # --- Executive summary
    story.append(Paragraph("Executive Summary", h2))
    if not narrative.get("ai_generated", False):
        story.append(
            Paragraph(
                "<i>Narrative generated deterministically; AI summary was unavailable.</i>",
                muted,
            )
        )
    story.append(Paragraph(narrative.get("executive_summary", ""), body))

    # --- Insights
    if narrative.get("key_insights"):
        story.append(Paragraph("Key Insights", h2))
        for item in narrative["key_insights"]:
            story.append(Paragraph(str(item), bullet, bulletText="•"))

    # --- Risks
    if narrative.get("risks"):
        story.append(Paragraph("Risks", h2))
        for item in narrative["risks"]:
            story.append(Paragraph(str(item), bullet, bulletText="•"))

    # --- Recommendations
    if narrative.get("recommendations"):
        story.append(Paragraph("Recommendations", h2))
        for item in narrative["recommendations"]:
            story.append(Paragraph(str(item), bullet, bulletText="•"))

    # --- Metrics block (compact key/value table)
    story.append(Paragraph("Metrics at a Glance", h2))
    metric_rows: list[list[str]] = []
    for k, v in metrics.items():
        if isinstance(v, (dict, list)):
            v = json.dumps(v, default=str)
        if isinstance(v, str) and len(v) > 80:
            v = v[:77] + "…"
        metric_rows.append([str(k).replace("_", " ").title(), str(v)])
    if metric_rows:
        metric_table = Table(
            metric_rows,
            colWidths=[60 * mm, 110 * mm],
            hAlign="LEFT",
        )
        metric_table.setStyle(
            TableStyle(
                [
                    ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
                    ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#6b7280")),
                    ("TEXTCOLOR", (1, 0), (1, -1), colors.HexColor("#111827")),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    (
                        "LINEBELOW",
                        (0, 0),
                        (-1, -1),
                        0.25,
                        colors.HexColor("#e5e7eb"),
                    ),
                ]
            )
        )
        story.append(metric_table)

    # --- Appendix: full data table
    story.append(PageBreak())
    story.append(Paragraph("Appendix — Detailed Data", h2))
    story.append(
        Paragraph(
            f"{len(rows)} record(s). This is the underlying data used to compute the metrics above.",
            muted,
        )
    )
    story.append(Spacer(1, 6))

    layout = _COLUMN_LAYOUTS.get(report_type) or [
        (k, k, 30) for k in (rows[0].keys() if rows else [])
    ]
    table_data: list[list[str]] = [[label for label, _, _ in layout]]
    for r in rows:
        row_cells = []
        for _, key, _ in layout:
            v = r.get(key, "")
            if v is None:
                v = "—"
            s = str(v)
            if len(s) > 30:
                s = s[:27] + "…"
            row_cells.append(s)
        table_data.append(row_cells)

    col_widths = [w * mm for _, _, w in layout]
    if table_data:
        appendix = Table(table_data, colWidths=col_widths, repeatRows=1)
        appendix.setStyle(
            TableStyle(
                [
                    ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
                    ("FONT", (0, 1), (-1, -1), "Helvetica", 8),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        story.append(appendix)
    else:
        story.append(Paragraph("(No rows to display.)", muted))

    doc.build(story)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post("/pdf")
async def generate_report_pdf(p: ReportPdfIn) -> StreamingResponse:
    calc = _METRIC_CALCULATORS.get(p.report_type)
    if calc is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported report_type={p.report_type}; "
                f"expected one of {sorted(_METRIC_CALCULATORS)}"
            ),
        )
    metrics = calc(p.rows)
    narrative = await _generate_narrative(p.report_type, metrics)
    subtitle = (
        p.title_subtitle
        or (f"Batch: {p.batch_name}" if p.batch_name else "All batches")
    )
    pdf_bytes = _build_pdf(
        report_type=p.report_type,
        rows=p.rows,
        metrics=metrics,
        narrative=narrative,
        subtitle=subtitle,
    )
    filename = f"{p.report_type}-report.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-AI-Generated": "1" if narrative.get("ai_generated") else "0",
        },
    )
