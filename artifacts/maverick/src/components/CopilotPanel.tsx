/**
 * Coordinator Copilot — slide-over panel.
 *
 * Triggered from the top Header. Opens from the right, 420px wide on
 * desktop, full-width on mobile. Consumes SSE from /api/copilot/query and
 * renders the result based on the `chart_type` field (table | number | bar).
 *
 * Deviation note: spec said "find the existing API client / fetch wrapper".
 * The codebase mixes generated TanStack Query hooks (Orval) with raw
 * `fetch` calls (see pages/Chatbot.tsx) for AI endpoints. We follow the
 * Chatbot pattern — `fetch` with `Authorization: Bearer <token>` — because
 * the streaming SSE response doesn't fit the generated hook contract.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Send,
  Sparkles,
  X,
  ThumbsUp,
  ThumbsDown,
  Bot,
  User as UserIcon,
  Trash2,
  Download,
  ArrowRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const SUGGESTED_QUERIES = [
  "Which batches have attendance below 80% this week?",
  "Who are the top 5 candidates in the current batch?",
  "Generate a summary for this batch",
  "Show attendance trends for the past month",
] as const;

type ChartType = "table" | "bar" | "number" | "help";

interface Row {
  [key: string]: string | number | boolean | null;
}

interface AssistantMessage {
  id: number;
  role: "assistant";
  /** "data" = SQL result; "help" = navigation/how-to answer. */
  mode?: "data" | "help";
  narrative: string;
  /** SQL is kept off the UI but retained for diagnostics. */
  sql?: string;
  rows?: Row[];
  chart_type?: ChartType;
  actions?: string[];
  // Help-mode payload — present when mode === "help".
  steps?: string[];
  navigate_to?: string | null;
  navigate_label?: string | null;
  error?: string;
  streaming?: boolean;
  tokens?: number;
  usageId?: string;
  /** Local UI state for the thumbs-up/down buttons. Persists only while the panel is open. */
  feedback?: "up" | "down" | "pending-up" | "pending-down";
}

interface UserMessage {
  id: number;
  role: "user";
  text: string;
}

type Message = UserMessage | AssistantMessage;

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * When true, the panel renders full-width inside its parent (used by the
   * /copilot route) instead of as a slide-over from the right edge.
   * The onClose / backdrop are not shown in this mode.
   */
  fullScreen?: boolean;
}

export function CopilotPanel({ open, onClose, fullScreen = false }: Props) {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionTokens, setSessionTokens] = useState(0);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Lock body scroll when the slide-over panel is open. Skipped in
  // fullScreen mode — that variant is mounted inside the normal page layout.
  useEffect(() => {
    if (!open || fullScreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open, fullScreen]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);

    const userMsg: UserMessage = { id: nextId.current++, role: "user", text: q };
    const assistantId = nextId.current++;
    const assistantStub: AssistantMessage = {
      id: assistantId, role: "assistant", narrative: "", streaming: true,
    };
    setMessages((m) => [...m, userMsg, assistantStub]);

    try {
      const res = await fetch("/api/copilot/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: q, batch_id: null }),
      });

      if (!res.ok) {
        const errText = await res.text();
        const msg =
          res.status === 401 ? "Couldn't reach the AI service. Check that port 9000 is running."
          : res.status === 502 ? "Couldn't reach the AI service. Check that port 9000 is running."
          : `Error ${res.status}: ${errText.slice(0, 200)}`;
        finishWith(assistantId, { narrative: msg, error: "request_failed" });
        return;
      }

      if (!res.body) {
        finishWith(assistantId, { narrative: "(empty response)" });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Parse the SSE event stream incrementally.
      // Format: `event: <name>\ndata: <json>\n\n`
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          handleSseChunk(assistantId, chunk);
        }
      }
    } catch (e) {
      finishWith(assistantId, {
        narrative: "Couldn't reach the AI service. Check that port 9000 is running.",
        error: String(e),
      });
    } finally {
      setBusy(false);
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId && msg.role === "assistant"
          ? { ...msg, streaming: false }
          : msg)),
      );
    }
  }

  function handleSseChunk(targetId: number, raw: string) {
    let event = "message";
    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed: any;
    try { parsed = JSON.parse(data); } catch { return; }

    if (event === "meta") {
      const isError = parsed.error === "timeout"
        ? "That query took too long. Try asking about a specific batch instead of all data."
        : parsed.error
          ? "I can only answer questions about batches, attendance, assessments, candidates, and feedback. Try rephrasing."
          : undefined;
      setMessages((m) => m.map((msg) =>
        msg.id === targetId && msg.role === "assistant"
          ? {
              ...msg,
              mode: parsed.mode,
              sql: parsed.sql,
              rows: parsed.rows,
              chart_type: parsed.chart_type,
              actions: parsed.actions,
              steps: parsed.steps,
              navigate_to: parsed.navigate_to ?? null,
              navigate_label: parsed.navigate_label ?? null,
              // Help mode arrives as a one-shot SSE: narrative is built
              // from the steps server-side and sent as a "token" event,
              // but we also seed it here in case the token event is missed.
              narrative: isError ?? msg.narrative,
              error: parsed.error,
            }
          : msg,
      ));
    } else if (event === "token") {
      setMessages((m) => m.map((msg) =>
        msg.id === targetId && msg.role === "assistant"
          ? { ...msg, narrative: (msg.narrative ?? "") + (parsed.text ?? "") }
          : msg,
      ));
    } else if (event === "done") {
      setSessionTokens((t) => t + (parsed.tokens_used ?? 0));
      setMessages((m) => m.map((msg) =>
        msg.id === targetId && msg.role === "assistant"
          ? { ...msg, tokens: parsed.tokens_used, usageId: parsed.usage_id, streaming: false }
          : msg,
      ));
    }
  }

  function finishWith(id: number, patch: Partial<AssistantMessage>) {
    setMessages((m) => m.map((msg) =>
      msg.id === id && msg.role === "assistant"
        ? { ...msg, ...patch, streaming: false }
        : msg,
    ));
  }

  async function sendFeedback(msg: AssistantMessage, helpful: boolean) {
    // Optimistic UI: flip the icon immediately so the click feels responsive,
    // then revert if the network call fails.
    const pending = helpful ? "pending-up" : "pending-down";
    setMessages((m) => m.map((x) =>
      x.id === msg.id && x.role === "assistant" ? { ...x, feedback: pending } : x,
    ));
    try {
      const res = await fetch("/api/copilot/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          usage_id: msg.usageId,
          query_text: msg.narrative.slice(0, 200),
          helpful,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessages((m) => m.map((x) =>
        x.id === msg.id && x.role === "assistant"
          ? { ...x, feedback: helpful ? "up" : "down" }
          : x,
      ));
    } catch {
      // Revert on failure so the user can retry.
      setMessages((m) => m.map((x) =>
        x.id === msg.id && x.role === "assistant" ? { ...x, feedback: undefined } : x,
      ));
    }
  }

  function clearChat() {
    if (busy) return;
    setMessages([]);
    setSessionTokens(0);
  }

  if (!open) return null;

  // Position / chrome differ between slide-over and full-screen mounts.
  const containerClasses = fullScreen
    ? "flex h-full w-full flex-col bg-background"
    : cn(
        "fixed right-0 top-0 z-50 flex h-full flex-col bg-background shadow-2xl",
        "w-full md:w-[420px]",
        "transition-transform duration-300 translate-x-0",
      );

  return (
    <>
      {/* Backdrop — only shown in slide-over mode */}
      {!fullScreen && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
          aria-hidden
        />
      )}

      {/* Panel */}
      <aside
        className={containerClasses}
        style={fullScreen ? undefined : { transform: "translateX(0)" }}
        role="dialog"
        aria-label="Coordinator Copilot"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            Coordinator Copilot
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearChat}
              disabled={busy || messages.length === 0}
              aria-label="Clear chat"
              title="Clear chat"
            >
              <Trash2 className="h-4 w-4" />
              <span className="ml-1 text-xs">Clear</span>
            </Button>
            {!fullScreen && (
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </header>

        {/* Message list */}
        <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <EmptyState onPick={send} />
          )}
          {messages.map((m) =>
            m.role === "user"
              ? <UserBubble key={m.id} text={m.text} />
              : <AssistantBubble
                  key={m.id}
                  msg={m}
                  onAction={send}
                  onFeedback={sendFeedback}
                  onNavigate={(href) => {
                    // Close the slide-over before navigating so the user
                    // lands on the destination page unobstructed. In
                    // fullScreen mode there is no panel to close.
                    if (!fullScreen) onClose();
                    navigate(href);
                  }}
                />,
          )}
        </div>

        {/* Input */}
        <div className="border-t p-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); send(input); }}
          >
            <input
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Ask about batches, attendance, candidates..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              disabled={busy}
            />
            <Button type="submit" disabled={busy || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
          {/* End-user cost footer intentionally omitted. Tokens + INR are
              still tracked in copilot_usage and exposed to admins via
              GET /api/copilot/usage-stats. */}
        </div>
      </aside>
    </>
  );
}

// ---------- subcomponents ----------------------------------------------------

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Ask anything about your batches, attendance, candidates, assessments,
        or feedback. Try one of these:
      </p>
      <div className="flex flex-wrap gap-2">
        {SUGGESTED_QUERIES.map((q) => (
          <button
            key={q}
            className="rounded-full border bg-muted/50 px-3 py-1.5 text-xs hover:bg-muted"
            onClick={() => onPick(q)}
            type="button"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end gap-2">
      <div className="max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
        {text}
      </div>
      <UserIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
    </div>
  );
}

function AssistantBubble({
  msg, onAction, onFeedback, onNavigate,
}: {
  msg: AssistantMessage;
  onAction: (q: string) => void;
  onFeedback: (msg: AssistantMessage, helpful: boolean) => void;
  onNavigate: (href: string) => void;
}) {
  const showSkeleton = msg.streaming && !msg.narrative && !msg.rows;
  // SQL is intentionally NOT exposed in the UI — surfacing raw SELECTs
  // makes the panel feel like a developer tool, not a coordinator tool.
  // The generated SQL is still stored in copilot_usage.generated_sql for
  // admin forensics via /api/copilot/usage-stats.
  const isTable = (msg.chart_type === "table" || !msg.chart_type) && (msg.rows?.length ?? 0) > 0;
  const showCsv = isTable && (msg.rows?.length ?? 0) > 10;

  function downloadCsv() {
    if (!msg.rows || msg.rows.length === 0) return;
    const cols = Object.keys(msg.rows[0]);
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      cols.join(","),
      ...msg.rows.map((r) => cols.map((c) => escape(r[c])).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `copilot-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex gap-2">
      <Bot className="h-5 w-5 shrink-0 text-primary" />
      <div className="max-w-[85%] flex-1 space-y-2">
        <div className="rounded-lg bg-muted px-3 py-2 text-sm">
          {showSkeleton ? <Skeleton /> : (
            <span>
              {msg.narrative}
              {msg.streaming && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-current align-middle" />}
            </span>
          )}
        </div>

        {msg.mode === "help" && (
          <HelpCard msg={msg} onNavigate={onNavigate} />
        )}

        {msg.rows && msg.rows.length > 0 && msg.chart_type === "number" && (
          <NumberCard rows={msg.rows} />
        )}
        {msg.rows && msg.rows.length > 0 && msg.chart_type === "bar" && (
          <BarChartCard rows={msg.rows} />
        )}
        {isTable && <TableCard rows={msg.rows!} />}

        {showCsv && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={downloadCsv}
              className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 hover:bg-muted"
            >
              <Download className="h-3 w-3" />
              Download CSV ({msg.rows!.length} rows)
            </button>
          </div>
        )}

        {msg.actions && msg.actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {msg.actions.map((a) => (
              <button
                key={a}
                onClick={() => onAction(a)}
                className="rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-muted"
                type="button"
              >
                {a}
              </button>
            ))}
          </div>
        )}

        {!msg.streaming && (
          <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
            <button
              onClick={() => onFeedback(msg, true)}
              className={cn(
                "rounded p-1 transition-colors hover:bg-muted",
                (msg.feedback === "up" || msg.feedback === "pending-up") &&
                  "bg-emerald-500/15 text-emerald-600",
              )}
              aria-label="Helpful"
              aria-pressed={msg.feedback === "up"}
              disabled={msg.feedback === "up" || msg.feedback === "down"}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onFeedback(msg, false)}
              className={cn(
                "rounded p-1 transition-colors hover:bg-muted",
                (msg.feedback === "down" || msg.feedback === "pending-down") &&
                  "bg-rose-500/15 text-rose-600",
              )}
              aria-label="Not helpful"
              aria-pressed={msg.feedback === "down"}
              disabled={msg.feedback === "up" || msg.feedback === "down"}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
            {msg.feedback === "up" && <span className="text-emerald-600">Thanks for the feedback</span>}
            {msg.feedback === "down" && <span className="text-rose-600">Marked as not helpful</span>}
            {(msg.feedback === "pending-up" || msg.feedback === "pending-down") && <span>Saving…</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-1.5">
      <div className="h-2 w-3/4 animate-pulse rounded bg-muted-foreground/30" />
      <div className="h-2 w-5/6 animate-pulse rounded bg-muted-foreground/30" />
      <div className="h-2 w-2/3 animate-pulse rounded bg-muted-foreground/30" />
    </div>
  );
}

function HelpCard({
  msg, onNavigate,
}: {
  msg: AssistantMessage;
  onNavigate: (href: string) => void;
}) {
  const steps = msg.steps ?? [];
  const href = msg.navigate_to;
  // Whitelist the destinations we'll navigate to — defence against the LLM
  // suggesting an off-app URL.
  const ALLOWED = new Set([
    "/dashboard", "/batches", "/candidates", "/attendance",
    "/assessments", "/toppers", "/feedback", "/reports",
    "/notifications", "/users", "/audit", "/settings",
  ]);
  const safeHref = href && ALLOWED.has(href) ? href : null;
  const label = msg.navigate_label || (safeHref ? `Open ${safeHref.slice(1).replace(/^\w/, (c) => c.toUpperCase())}` : "");

  if (steps.length === 0 && !safeHref) return null;

  return (
    <div className="rounded border bg-background p-3 space-y-2">
      {steps.length > 0 && (
        <ol className="ml-4 list-decimal space-y-1 text-sm">
          {steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )}
      {safeHref && (
        <button
          type="button"
          onClick={() => onNavigate(safeHref)}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          {label}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function TableCard({ rows }: { rows: Row[] }) {
  const cols = Object.keys(rows[0] ?? {});
  return (
    <div className="overflow-x-auto rounded border bg-background">
      <table className="w-full text-xs">
        <thead className="bg-muted">
          <tr>{cols.map((c) => <th key={c} className="px-2 py-1.5 text-left font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            <tr key={i} className="border-t">
              {cols.map((c) => <td key={c} className="px-2 py-1.5">{String(r[c] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && (
        <div className="border-t bg-muted/30 px-2 py-1 text-center text-xs text-muted-foreground">
          showing 50 of {rows.length}
        </div>
      )}
    </div>
  );
}

function NumberCard({ rows }: { rows: Row[] }) {
  const first = rows[0] ?? {};
  const key = Object.keys(first)[0];
  const val = key ? first[key] : "";
  return (
    <div className="rounded border bg-background px-4 py-6 text-center">
      <div className="text-3xl font-bold">{String(val ?? "")}</div>
      {key && <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{key}</div>}
    </div>
  );
}

function BarChartCard({ rows }: { rows: Row[] }) {
  const cols = Object.keys(rows[0] ?? {});
  const labelKey = cols[0];
  const valueKey = cols.find((c) => typeof rows[0][c] === "number") ?? cols[1];
  if (!labelKey || !valueKey) return <TableCard rows={rows} />;
  const data = rows.map((r) => ({
    name: String(r[labelKey]),
    value: typeof r[valueKey] === "number" ? r[valueKey] : Number(r[valueKey] ?? 0),
  }));
  return (
    <div className="h-48 rounded border bg-background p-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Bar dataKey="value" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
