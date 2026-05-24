import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Layout } from "@/components/layout/Layout";
import { Send, Bot, User as UserIcon } from "lucide-react";

interface Turn {
  id: number;
  role: "user" | "assistant" | "error";
  text: string;
  sql?: string;
}

export default function Chatbot() {
  const { user, token } = useAuth();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  if (!user) return null;

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const userTurn: Turn = { id: nextId.current++, role: "user", text: q };
    setTurns((t) => [...t, userTurn]);

    try {
      const res = await fetch("/api/ai/chatbot/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          coordinator_id: user!.id,
          question: q,
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        setTurns((t) => [
          ...t,
          { id: nextId.current++, role: "error", text: `Error ${res.status}: ${msg}` },
        ]);
      } else {
        const data = (await res.json()) as {
          summary?: string;
          sql_generated?: string;
        };
        setTurns((t) => [
          ...t,
          {
            id: nextId.current++,
            role: "assistant",
            text: data.summary ?? "(empty response)",
            sql: data.sql_generated,
          },
        ]);
      }
    } catch (err) {
      setTurns((t) => [
        ...t,
        { id: nextId.current++, role: "error", text: String(err) },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <Layout>
    <div className="flex h-full flex-col gap-4 p-6">
      <div>
        <h1 className="text-3xl font-bold">Chatbot</h1>
        <p className="text-muted-foreground">
          Ask natural-language questions about your batches. The AI writes SQL
          scoped to your access and summarises the answer.
        </p>
      </div>

      <Card className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {turns.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
              <Bot className="mb-3 h-10 w-10 opacity-40" />
              <p className="text-sm">Try: "How many candidates are active in my batches?"</p>
              <p className="text-sm">Or: "Average attendance in batch 1 over the last 14 days"</p>
            </div>
          )}

          {turns.map((t) => (
            <div
              key={t.id}
              className={`flex gap-3 ${t.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {t.role !== "user" && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                  t.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : t.role === "error"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted"
                }`}
              >
                <p className="whitespace-pre-wrap">{t.text}</p>
                {t.sql && (
                  <details className="mt-2 text-xs opacity-75">
                    <summary className="cursor-pointer">SQL</summary>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono">{t.sql}</pre>
                  </details>
                )}
              </div>
              {t.role === "user" && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <UserIcon className="h-4 w-4 text-primary" />
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="flex justify-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="rounded-lg bg-muted px-4 py-2">
                <Spinner className="h-4 w-4" />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="flex gap-2 border-t bg-background/50 p-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask about your batches…"
            rows={1}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={busy}
          />
          <Button onClick={send} disabled={busy || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </div>
    </Layout>
  );
}
