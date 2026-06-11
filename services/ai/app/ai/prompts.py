from langchain.prompts import ChatPromptTemplate

# Feature 1 — Feedback Analyzer
FEEDBACK_THEMES_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You analyze training feedback. Extract themes precisely. "
     'Return strict JSON: {{"themes":[{{"text":str,"category":"complaint|improvement|positive","frequency":int}}]}}'),
    ("user", "Feedback responses (one per line):\n{responses}"),
])

FEEDBACK_SCORE_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "Given themes + raw responses, produce strict JSON:\n"
     "{{\n"
     '  "sentiment_distribution": {{"positive": float, "neutral": float, "negative": float}},\n'
     '  "top_complaints": [str up to 5],\n'
     '  "improvement_requests": [str up to 5],\n'
     '  "quality_insights": str (1-2 sentences),\n'
     '  "trainer_effectiveness_score": float 0-10\n'
     "}}\n"
     "Percentages must sum to 100."),
    ("user", "Themes:\n{themes}\n\nRaw:\n{responses}"),
])

# Feature 2 — Notification generator
TONE_MAP = {
    1: "warm, gentle, friendly — no escalation language",
    2: "firm and professional, with explicit deadline",
    3: "escalation tone, formal, names the manager, sets immediate action item",
}

NOTIFICATION_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You write professional internal training emails for Hexaware.\n"
     "Tone: {tone}\n"
     "Constraints: max 90 words body, plain text, no emojis, no marketing speak. "
     "Always sign off as 'Maverick TMS'. "
     'Return strict JSON: {{"subject": str, "body": str}}.'),
    ("user",
     "Notification type: {type}\nRecipient: {name}\nContext JSON: {context}\nUrgency: level {urgency}"),
])

# Feature 3 — NL→SQL
SCHEMA_CARD = """
Tables:
  batches(id, batch_code, name, program, status, start_date, end_date, coordinator_id,
          attendance_threshold_pct, clearance_threshold_pct)
  candidates(id, employee_id, full_name, email, batch_id, status)
  attendance(candidate_id, batch_id, attend_date, status)
                                     -- status in present|absent|leave|holiday
  assessments(candidate_id, batch_id, assessment_type, score, max_score, passed, scheduled_date)
                                     -- assessment_type in 'sprint'|'api'|'project'
Rules:
  - ONLY produce a single SELECT statement (no semicolons except trailing).
  - Never use DDL, DML, pg_*, or SET commands.
  - Always include `where batch_id in ({allowed_ids})` for batch-scoped tables.
  - Use ROUND(x * 100, 1) for percentages.
"""

CHATBOT_SQL_PROMPT = ChatPromptTemplate.from_messages([
    ("system", "You convert natural language to PostgreSQL SQL.\n{schema}"),
    ("user", "Allowed batch IDs: {ids}\nRetrieved context:\n{context}\n\nQuestion: {q}\n\nReturn ONLY the SQL."),
])

CHATBOT_SUMMARY_PROMPT = ChatPromptTemplate.from_messages([
    ("system", "Summarize the SQL result for a non-technical coordinator in 1-2 sentences."),
    ("user", "Question: {q}\nRows: {rows}"),
])
